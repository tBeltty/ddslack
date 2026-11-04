// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import type { AllMiddlewareArgs, BlockAction, OverflowAction, SlackActionMiddlewareArgs } from '@slack/bolt';
import { cooldownMessage } from '../../lib/cooldown.js';
import { parseSpecialRoll } from '../../lib/messages.js';
import { rollFailedMessage, slackErrorCode } from '../../lib/publish.js';
import { abilityScoresView, deathSaveView } from '../../lib/roll.js';
import { type ListenerOptions, tokenOf } from '../options.js';
import { targetFromAction } from './action-target.js';
import { privateNote } from './private-note.js';

/** The picker's "⋯" menu: ability scores for a new character, or a death saving throw. */
export function specialRoll({ table, publicBaseUrl, cooldown }: ListenerOptions) {
  return async ({
    ack,
    body,
    action,
    logger,
    context,
  }: AllMiddlewareArgs & SlackActionMiddlewareArgs<BlockAction<OverflowAction>>): Promise<void> => {
    await ack();
    const special = parseSpecialRoll(action.selected_option.value);
    const target = special ? targetFromAction(body, special.target) : null;
    if (!special || !target) return;
    const turn = cooldown.take(body.user.id);
    if (!turn.ok) {
      await privateNote(body, cooldownMessage(turn.waitMs), logger);
      return;
    }

    const base = { userId: body.user.id, ...(publicBaseUrl ? { publicBaseUrl } : {}) };
    try {
      await table.roll({
        ...tokenOf(context),
        target,
        userId: body.user.id,
        view: special.kind === 'stats' ? abilityScoresView(base) : deathSaveView(base),
        ...(target.responseUrl ? { fallbackResponseUrl: target.responseUrl } : {}),
      });
    } catch (err) {
      const code = slackErrorCode(err);
      logger.error(`[special_roll] roll failed: ${code ?? String(err)}`);
      await privateNote(body, rollFailedMessage(err), logger);
    }
  };
}
