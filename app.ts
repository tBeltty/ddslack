// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { join } from 'node:path';
import { App, type Authorize, SocketModeReceiver, webApi } from '@slack/bolt';
import { loadDiceImages, setStripKey } from './lib/assets.js';
import { loadEnv, readConfig } from './lib/config.js';
import { Cooldown } from './lib/cooldown.js';
import { createAppServer } from './lib/http.js';
import { createInstaller } from './lib/install.js';
import { Preferences } from './lib/preferences.js';
import { deriveKey } from './lib/secrets.js';
import { Table } from './lib/table.js';
import registerListeners from './listeners/index.js';

let env: NodeJS.ProcessEnv;
try {
  env = loadEnv(process.env);
} catch (err) {
  const code = (err as NodeJS.ErrnoException).code ?? 'unreadable';
  console.error(`Cannot load APP_ENV_FILE ${process.env.APP_ENV_FILE}: ${code}.`);
  process.exit(1);
}

const loaded = readConfig(env);
if (!loaded.ok) {
  console.error(`Missing environment variables: ${loaded.missing.join(', ')}.`);
  process.exit(1);
}
const { botToken, appToken, port, logLevel, publicBaseUrl, dataDir, distribution } = loaded.config;

// Ready means the Socket Mode connection to Slack is open; /healthz reports it.
let connected = false;
const receiver = new SocketModeReceiver({ appToken, logLevel });
receiver.client.on('connected', () => {
  connected = true;
});
for (const state of ['reconnecting', 'disconnecting', 'disconnected']) {
  receiver.client.on(state, () => {
    connected = false;
  });
}

// The library default retries for about 30 minutes; a dice roll is worth a few seconds at most.
const clientOptions = { timeout: 10_000, retryConfig: { retries: 2, maxTimeout: 5_000 } };

const app = distribution
  ? new App({ receiver, logLevel, clientOptions, authorize: (source) => authorize(source) })
  : new App({ token: botToken as string, receiver, logLevel, clientOptions });

// With distribution, each workspace's token comes from its installation. The home workspace keeps
// its original bot token until it installs through the link, so it never stops working.
const install = distribution ? createInstaller({ distribution, dataDir, logger: app.logger, ...(publicBaseUrl ? { publicBaseUrl } : {}) }) : null;
let home: Promise<{ teamId?: string; botId?: string; botUserId?: string }> | null = null;
const authorize: Authorize<boolean> = async (source) => {
  if (!install) throw new Error('The app is not distributed');
  try {
    return await install.installer.authorize(source);
  } catch (err) {
    if (!botToken) throw err;
    home ??= new webApi.WebClient(botToken, clientOptions).auth.test().then((r) => ({
      ...(r.team_id ? { teamId: r.team_id } : {}),
      ...(r.bot_id ? { botId: r.bot_id } : {}),
      ...(r.user_id ? { botUserId: r.user_id } : {}),
    }));
    const { teamId, botId, botUserId } = await home;
    if (source.teamId !== teamId) throw err;
    return { botToken, ...(botId ? { botId } : {}), ...(botUserId ? { botUserId } : {}), teamId };
  }
};
if (install) app.logger.info(`Distribution is on; ${install.store.size} workspace installation(s) stored.`);

// Strip URLs are signed with a key only this app holds.
setStripKey(distribution ? deriveKey(distribution.appSecret, 'dice strips').toString('hex') : (botToken ?? null));

const preferences = Preferences.inDirectory(dataDir, (message) => app.logger.warn(message));
const table = new Table({
  // Each workspace gets its own clients; housekeeping gives up at once on a rate limit instead of
  // pausing every roll behind it.
  clientsFor: (token) => ({
    client: new webApi.WebClient(token, { ...clientOptions, logger: app.logger }),
    tidy: new webApi.WebClient(token, {
      logger: app.logger,
      timeout: 5_000,
      rejectRateLimitedCalls: true,
      retryConfig: { retries: 0 },
    }),
  }),
  logger: app.logger,
  styleOf: (userId) => preferences.style(userId),
  ...(publicBaseUrl ? { publicBaseUrl } : {}),
});
registerListeners(app, {
  table,
  preferences,
  cooldown: new Cooldown(),
  ...(install ? { installations: install.store } : {}),
  ...(publicBaseUrl ? { publicBaseUrl } : {}),
});

// The working directory is the repository root in development and /app in the image.
const images = loadDiceImages(join(process.cwd(), 'assets', 'dice'));
const server = createAppServer({
  isReady: () => connected,
  images,
  ...(install ? { installer: install.routes } : {}),
  logError: (message) => app.logger.error(message),
});
server.listen(port, '0.0.0.0', () => app.logger.info(`Listening on :${port} (healthz and die images)`));
if (!publicBaseUrl) app.logger.warn('PUBLIC_BASE_URL is not set; rolls are posted without die images.');

try {
  await app.start();
  app.logger.info('Dice Companion connected over Socket Mode.');
} catch (err) {
  app.logger.error('Unable to start the app', err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    connected = false;
    server.close();
    // Let reveals in flight finish so no roll is left stuck on "rolling…".
    const drained = Promise.race([table.drain(), new Promise((resolve) => setTimeout(resolve, 3000))]);
    drained.then(() => app.stop()).finally(() => process.exit(0));
  });
}
