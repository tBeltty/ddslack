// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Logger } from '@slack/bolt';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type CallbackOptions,
  defaultCallbackFailure,
  defaultCallbackSuccess,
  type Installation,
  InstallProvider,
} from '@slack/oauth';
import type { Distribution } from './config.js';
import { FileInstallationStore } from './installations.js';
import { deriveKey } from './secrets.js';

/** The bot scopes every workspace grants; tests/manifest.test.ts keeps them equal to manifest.json. */
export const BOT_SCOPES = ['app_mentions:read', 'chat:write', 'commands', 'reactions:write'];

export const INSTALL_PATH = '/slack/install';
export const REDIRECT_PATH = '/slack/oauth_redirect';

/** What the app server needs to run the install link and Slack's redirect back. */
export interface InstallRoutes {
  handleInstallPath(req: IncomingMessage, res: ServerResponse): Promise<void>;
  handleCallback(req: IncomingMessage, res: ServerResponse): Promise<void>;
}

/**
 * Slack's OAuth flow for other workspaces: `/slack/install` sends the person to Slack to approve
 * the app, and `/slack/oauth_redirect` stores the workspace's bot token and opens the app in Slack.
 *
 * Installs started from our link carry a signed `state` tied to the browser, and it is checked.
 * Installs started inside Slack (its Sharable URL, "Add to Slack" or "Install to Workspace" in the
 * app settings) come back with no state at all; they are accepted, since the code they carry can
 * only install the app in the workspace of whoever approved it.
 */
export function createInstaller(o: {
  distribution: Distribution;
  dataDir: string;
  publicBaseUrl?: string;
  logger: Logger;
  /** Where Slack's Web API lives; tests point it at a local fake. */
  slackApiUrl?: string;
}): { installer: InstallProvider; routes: InstallRoutes; store: FileInstallationStore } {
  const { clientId, clientSecret, appSecret } = o.distribution;
  const store = FileInstallationStore.inDirectory(o.dataDir, deriveKey(appSecret, 'installations'), (message) =>
    o.logger.warn(message)
  );
  const shared = {
    clientId,
    clientSecret,
    installationStore: store,
    installUrlOptions: {
      scopes: BOT_SCOPES,
      ...(o.publicBaseUrl ? { redirectUri: `${o.publicBaseUrl}${REDIRECT_PATH}` } : {}),
    },
    logger: o.logger,
    ...(o.slackApiUrl ? { clientOptions: { slackApiUrl: o.slackApiUrl } } : {}),
  };
  const installer = new InstallProvider({
    ...shared,
    stateSecret: deriveKey(appSecret, 'oauth state').toString('hex'),
    directInstall: true,
  });
  const fromSlack = new InstallProvider({ ...shared, stateVerification: false, logger: quiet(o.logger) });

  const outcome: CallbackOptions = {
    success: (installation, options, req, res) => {
      const where = installation.isEnterpriseInstall ? installation.enterprise?.id : installation.team?.id;
      o.logger.info(`[install] installed in ${where ?? 'unknown'}; ${store.size} installation(s) stored`);
      defaultCallbackSuccess(installation as Installation, options, req, res);
    },
    failure: (error, options, req, res) => {
      o.logger.warn(`[install] install failed: ${error.code ?? error.message}`);
      defaultCallbackFailure(error, options, req, res);
    },
  };
  const routes: InstallRoutes = {
    handleInstallPath: (req, res) => installer.handleInstallPath(req, res),
    handleCallback: (req, res) => {
      const hasState = new URL(req.url ?? '/', 'http://local').searchParams.has('state');
      return (hasState ? installer : fromSlack).handleCallback(req, res, outcome);
    },
  };
  return { installer, routes, store };
}

/** The no-state provider warns at startup that state checks are off; that is deliberate here. */
function quiet(logger: Logger): Logger {
  return new Proxy(logger, {
    get: (target, key) =>
      key === 'warn'
        ? (...args: unknown[]) => {
            if (!String(args[0]).includes('stateVerification to false')) target.warn(...args);
          }
        : Reflect.get(target, key),
  });
}
