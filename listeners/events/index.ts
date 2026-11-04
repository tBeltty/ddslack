// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import type { App } from '@slack/bolt';
import type { ListenerOptions } from '../options.js';
import { appHomeOpened } from './app-home-opened.js';
import { appMention } from './app-mention.js';
import { forgetInstallation } from './uninstalled.js';

// Mentions, the Home tab and uninstalls only: the app never subscribes to `message.*` events.
export function register(app: App, options: ListenerOptions): void {
  app.event('app_mention', appMention(options));
  app.event('app_home_opened', appHomeOpened(options));
  app.event('app_uninstalled', forgetInstallation(options));
  app.event('tokens_revoked', forgetInstallation(options));
}
