// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import type { AnyMiddlewareArgs, App } from '@slack/bolt';

interface Interaction {
  type?: string;
  actions?: Array<{ action_id?: string }>;
  channel?: { id?: string };
  container?: { type?: string; is_ephemeral?: boolean };
  view?: { callback_id?: string };
}

/** One line per interaction that reaches the app, so a click that never arrives shows as a gap. */
export function describeInteraction(body: AnyMiddlewareArgs['body']): string | null {
  const b = body as Interaction;
  if (b.type === 'block_actions') {
    const ids = (b.actions ?? []).map((a) => a.action_id).join(',');
    const where = `${b.container?.type ?? '-'}${b.container?.is_ephemeral ? ' ephemeral' : ''}`;
    return `action=${ids} channel=${b.channel?.id ?? '-'} container=${where}`;
  }
  if (b.type === 'view_submission') return `view_submission callback=${b.view?.callback_id ?? '-'}`;
  return null;
}

export function register(app: App): void {
  app.use(async ({ body, logger, next }) => {
    const line = describeInteraction(body);
    if (line) logger.info(`[interaction] ${line}`);
    await next();
  });
}
