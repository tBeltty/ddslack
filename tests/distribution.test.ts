import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from '@slack/bolt';
import type { Installation } from '@slack/oauth';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppServer } from '../lib/http.js';
import { FileInstallationStore } from '../lib/installations.js';
import { deriveKey } from '../lib/secrets.js';
import { type ChatApi, Table } from '../lib/table.js';
import { forgetInstallation } from '../listeners/events/uninstalled.js';
import type { ListenerOptions } from '../listeners/options.js';

const silent = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  getLevel: () => 'info',
  setLevel() {},
  setName() {},
} as unknown as Logger;
const SECRET = 's'.repeat(40);
const install = (team: string, token: string) =>
  ({
    team: { id: team, name: 'Guild' },
    enterprise: undefined,
    user: { id: 'U1', token: undefined, scopes: undefined },
    bot: { token, scopes: ['chat:write'], id: 'B1', userId: 'U0BOT' },
    isEnterpriseInstall: false,
  }) as Installation;

describe('stored installations', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('keeps each workspace token encrypted on disk and reads it back after a restart', async () => {
    dir = mkdtempSync(join(tmpdir(), 'installs-'));
    const key = deriveKey(SECRET, 'installations');
    await FileInstallationStore.inDirectory(dir, key).storeInstallation(install('T1', 'xoxb-secret-1'));
    const file = readFileSync(join(dir, 'installations.json'), 'utf8');
    // Only the sealed envelope is on disk: no token, team id or name in the clear.
    const sealed = JSON.parse(file);
    expect(Object.keys(sealed).sort()).toEqual(['data', 'iv', 'tag', 'v']);
    expect(file).not.toContain('xoxb-secret-1');
    expect(file).not.toContain('Guild');
    expect(Buffer.from(sealed.data, 'base64').toString('latin1')).not.toContain('xoxb-secret-1');
    const again = FileInstallationStore.inDirectory(dir, key);
    expect((await again.fetchInstallation({ teamId: 'T1', enterpriseId: undefined, isEnterpriseInstall: false })).bot?.token).toBe('xoxb-secret-1');
    await expect(again.fetchInstallation({ teamId: 'T2', enterpriseId: undefined, isEnterpriseInstall: false })).rejects.toThrow();
  });

  it('refuses to start with the wrong key instead of overwriting the tokens', async () => {
    dir = mkdtempSync(join(tmpdir(), 'installs-'));
    await FileInstallationStore.inDirectory(dir, deriveKey(SECRET, 'installations')).storeInstallation(install('T1', 'x'));
    expect(() => FileInstallationStore.inDirectory(dir as string, deriveKey('t'.repeat(40), 'installations'))).toThrow();
  });

  it('forgets a workspace that uninstalls the app', async () => {
    dir = mkdtempSync(join(tmpdir(), 'installs-'));
    const store = FileInstallationStore.inDirectory(dir, deriveKey(SECRET, 'installations'));
    await store.storeInstallation(install('T1', 'xoxb-1'));
    const handler = forgetInstallation({ installations: store } as unknown as ListenerOptions);
    await handler({ event: { type: 'app_uninstalled' }, context: { teamId: 'T1' }, logger: silent } as never);
    expect(store.size).toBe(0);
  });

  it('keeps the installation when only user tokens are revoked', async () => {
    dir = mkdtempSync(join(tmpdir(), 'installs-'));
    const store = FileInstallationStore.inDirectory(dir, deriveKey(SECRET, 'installations'));
    await store.storeInstallation(install('T1', 'xoxb-1'));
    const handler = forgetInstallation({ installations: store } as unknown as ListenerOptions);
    await handler({
      event: { type: 'tokens_revoked', tokens: { oauth: ['U1'] } },
      context: { teamId: 'T1' },
      logger: silent,
    } as never);
    expect(store.size).toBe(1);
  });

  it('derives a different key for each use of the one secret', () => {
    const keys = (['installations', 'oauth state', 'dice strips'] as const).map((p) => deriveKey(SECRET, p).toString('hex'));
    expect(new Set(keys).size).toBe(3);
  });
});

describe('install link', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('sends /slack/install and the OAuth redirect to the installer, uncached', async () => {
    const seen: string[] = [];
    const installer = {
      handleInstallPath: async (_req: unknown, res: import('node:http').ServerResponse) => {
        seen.push('install');
        res.writeHead(302, { Location: 'https://slack.com/oauth/v2/authorize?client_id=1' });
        res.end();
      },
      handleCallback: async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
        seen.push(`callback ${req.url}`);
        res.writeHead(200);
        res.end('installed');
      },
    };
    const server = createAppServer({ isReady: () => true, images: new Map(), installer: installer as never });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    close = () => new Promise((resolve) => server.close(() => resolve()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const start = await fetch(`${base}/slack/install`, { redirect: 'manual' });
    expect(start.status).toBe(302);
    expect(start.headers.get('cache-control')).toBe('no-store');
    const back = await fetch(`${base}/slack/oauth_redirect?code=abc&state=xyz`);
    expect(await back.text()).toBe('installed');
    expect(seen).toEqual(['install', 'callback /slack/oauth_redirect?code=abc&state=xyz']);
  });

  it('has no install routes while the app is not distributed', async () => {
    const server = createAppServer({ isReady: () => true, images: new Map() });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    close = () => new Promise((resolve) => server.close(() => resolve()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect((await fetch(`${base}/slack/install`, { redirect: 'manual' })).status).toBe(404);
  });
});

describe('rolls in several workspaces', () => {
  it('posts with each workspace token and keeps a separate rate-limit budget for each', async () => {
    const posts: string[] = [];
    let n = 0;
    const clientsFor = (token: string) => {
      const client: ChatApi = {
        chat: {
          postMessage: async (a) => {
            posts.push(`${token}:${a.text.includes('is rolling') ? 'rolling' : 'result'}`);
            return { ts: `1700000001.${String(++n).padStart(6, '0')}` };
          },
          update: async () => ({}),
          delete: async () => ({}),
        },
        reactions: { add: async () => ({}) },
      };
      return { client, tidy: client };
    };
    const table = new Table({ clientsFor, logger: silent, sleep: async () => {}, now: () => 0 });
    for (let i = 0; i < 46; i++) {
      await table.roll({ target: { channel: 'C1' }, userId: 'U1', expression: '1d6', token: 'xoxb-A', rng: () => 2 });
      await table.drain();
    }
    await table.roll({ target: { channel: 'C9' }, userId: 'U9', expression: '1d6', token: 'xoxb-B', rng: () => 2 });
    await table.drain();
    expect(posts.at(-2)).toBe('xoxb-A:result');
    expect(posts.at(-1)).toBe('xoxb-B:rolling');
  });
});

describe('installing through Slack', () => {
  let stop: Array<() => Promise<void>> = [];
  let dir: string | undefined;
  afterEach(async () => {
    for (const s of stop) await s();
    stop = [];
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  async function listen(server: import('node:http').Server): Promise<string> {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    stop.push(() => new Promise((resolve) => server.close(() => resolve())));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  async function setUp() {
    const { createServer } = await import('node:http');
    const { createInstaller } = await import('../lib/install.js');
    // A stand-in for Slack's Web API: exchanges any code for a bot token.
    const slack = await listen(
      createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url?.startsWith('/api/oauth.v2.access')) {
          res.end(
            JSON.stringify({
              ok: true,
              app_id: 'A1',
              authed_user: { id: 'U1' },
              scope: 'chat:write',
              token_type: 'bot',
              access_token: 'xoxb-installed',
              bot_user_id: 'U0BOT',
              team: { id: 'T42', name: 'Guild' },
              enterprise: null,
              is_enterprise_install: false,
            })
          );
        } else if (req.url?.startsWith('/api/auth.test')) {
          res.end(JSON.stringify({ ok: true, bot_id: 'B1', user_id: 'U0BOT', team_id: 'T42' }));
        } else {
          res.end(JSON.stringify({ ok: false, error: 'unknown_method' }));
        }
      })
    );
    dir = mkdtempSync(join(tmpdir(), 'installs-'));
    const install = createInstaller({
      distribution: { clientId: '1.2', clientSecret: 'cs', appSecret: SECRET },
      dataDir: dir,
      logger: silent,
      slackApiUrl: `${slack}/api/`,
    });
    const base = await listen(createAppServer({ isReady: () => true, images: new Map(), installer: install.routes }));
    return { base, store: install.store };
  }

  it('accepts an install started inside Slack, which comes back without state', async () => {
    const { base, store } = await setUp();
    const res = await fetch(`${base}/slack/oauth_redirect?code=from-slack`);
    expect(res.status).toBe(200);
    const installed = await store.fetchInstallation({ teamId: 'T42', enterpriseId: undefined, isEnterpriseInstall: false });
    expect(installed.bot?.token).toBe('xoxb-installed');
  });

  it('still refuses a redirect whose state was forged', async () => {
    const { base, store } = await setUp();
    const res = await fetch(`${base}/slack/oauth_redirect?code=x&state=forged`);
    expect(res.status).toBe(400);
    expect(store.size).toBe(0);
  });
});
