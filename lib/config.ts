// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { LogLevel } from '@slack/bolt';

/** What other workspaces need to install the app through Slack's OAuth flow. */
export interface Distribution {
  clientId: string;
  clientSecret: string;
  /** Long random secret: signs the OAuth state and keys the encryption of stored installations. */
  appSecret: string;
}

export interface Config {
  /**
   * The home workspace's bot token. Required unless the app is distributed; when both are set,
   * the home workspace keeps working with it until it installs through OAuth.
   */
  botToken?: string;
  appToken: string;
  distribution?: Distribution;
  port: number;
  logLevel: LogLevel;
  /** Public HTTPS origin that serves the die images; without it rolls are text only. */
  publicBaseUrl?: string;
  /** Where the app keeps its files: each person's message style and, when distributed, the installations. */
  dataDir: string;
}

const LOG_LEVELS: Record<string, LogLevel> = {
  debug: LogLevel.DEBUG,
  info: LogLevel.INFO,
  warn: LogLevel.WARN,
  error: LogLevel.ERROR,
};

/** Port the container contract expects; local development overrides it with PORT. */
export const DEFAULT_PORT = 8080;

/**
 * Merges the dotenv file named by APP_ENV_FILE (KEY='value' lines) under the process
 * environment. Variables already set in the environment win over the file.
 */
export function loadEnv(
  env: NodeJS.ProcessEnv,
  read: (path: string) => string = (path) => readFileSync(path, 'utf8')
): NodeJS.ProcessEnv {
  const file = env.APP_ENV_FILE?.trim();
  if (!file) return env;
  return { ...parseEnv(read(file)), ...env };
}

/** Reads configuration from the environment. Returns the missing keys on failure. */
export function readConfig(env: NodeJS.ProcessEnv): { ok: true; config: Config } | { ok: false; missing: string[] } {
  const value = (key: string) => env[key]?.trim() || undefined;
  const botToken = value('SLACK_BOT_TOKEN');
  const appToken = value('SLACK_APP_TOKEN');
  const oauthKeys = ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'APP_SECRET'];
  const oauthSet = oauthKeys.filter((key) => value(key));

  const missing: string[] = [];
  if (!appToken) missing.push('SLACK_APP_TOKEN');
  // Distribution is all three keys or none; with none, the home workspace's bot token is needed.
  if (oauthSet.length > 0) missing.push(...oauthKeys.filter((key) => !value(key)));
  else if (!botToken) missing.push('SLACK_BOT_TOKEN');
  if ((value('APP_SECRET')?.length ?? 32) < 32) missing.push('APP_SECRET (at least 32 characters)');
  if (missing.length > 0 || !appToken) return { ok: false, missing };

  const clientId = value('SLACK_CLIENT_ID');
  const clientSecret = value('SLACK_CLIENT_SECRET');
  const appSecret = value('APP_SECRET');
  const distribution = clientId && clientSecret && appSecret ? { clientId, clientSecret, appSecret } : undefined;
  const port = Number(env.PORT ?? DEFAULT_PORT);
  const publicBaseUrl = parseBaseUrl(env.PUBLIC_BASE_URL);
  return {
    ok: true,
    config: {
      ...(botToken ? { botToken } : {}),
      appToken,
      ...(distribution ? { distribution } : {}),
      port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT,
      logLevel: LOG_LEVELS[env.LOG_LEVEL?.toLowerCase() ?? ''] ?? LogLevel.INFO,
      ...(publicBaseUrl ? { publicBaseUrl } : {}),
      dataDir: env.DATA_DIR?.trim() || 'data',
    },
  };
}

/** Accepts only an https origin (no path, query or credentials), since Slack fetches it publicly. */
function parseBaseUrl(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const isOrigin = url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
    return url.protocol === 'https:' && isOrigin ? url.origin : undefined;
  } catch {
    return undefined;
  }
}
