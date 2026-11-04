// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import type { App } from '@slack/bolt';
import type { ListenerOptions } from '../options.js';
import { roll } from './roll.js';

export function register(app: App, options: ListenerOptions): void {
  app.command('/roll', roll(options));
}
