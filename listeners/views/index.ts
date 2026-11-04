// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import type { App } from '@slack/bolt';
import { ROLL_MODAL } from '../../lib/messages.js';
import type { ListenerOptions } from '../options.js';
import { rollModalSubmit } from './roll-modal.js';

export function register(app: App, options: ListenerOptions): void {
  app.view(ROLL_MODAL, rollModalSubmit(options));
}
