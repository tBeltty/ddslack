// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import type { AllMiddlewareArgs, BlockButtonAction, SlackActionMiddlewareArgs } from '@slack/bolt';
import { cooldownMessage } from '../../lib/cooldown.js';
import { choiceExpression, type FormValues, readPicker, rollTypeProblem } from '../../lib/messages.js';
import { rollFailedMessage, slackErrorCode } from '../../lib/publish.js';
import { type ListenerOptions, tokenOf } from '../options.js';
import { targetFromAction } from './action-target.js';
import { privateNote } from './private-note.js';

/**
 * The picker's Roll button: rolls what its menus are set to, where the picker lives. A roll
 * type that does not fit the die gets a private note instead of a roll.
 */
export function rollPicker({ table, cooldown }: ListenerOptions) {
  return async ({
    ack,
    body,
    action,
    logger,
    context,
  }: AllMiddlewareArgs & SlackActionMiddlewareArgs<BlockButtonAction>): Promise<void> => {
    await ack();
    const target = targetFromAction(body, action.value);
    if (!target) return;

    const choice = readPicker(body.state as { values?: FormValues } | undefined);
    const problem = rollTypeProblem(choice);
    if (problem) {
      await privateNote(body, problem, logger);
      return;
    }
    const turn = cooldown.take(body.user.id);
    if (!turn.ok) {
      await privateNote(body, cooldownMessage(turn.waitMs), logger);
      return;
    }
    try {
      await table.roll({
        ...tokenOf(context),
        target,
        userId: body.user.id,
        expression: choiceExpression(choice),
        ...(choice.type === 'critical' ? { critical: true } : {}),
        ...(target.responseUrl ? { fallbackResponseUrl: target.responseUrl } : {}),
      });
    } catch (err) {
      const code = slackErrorCode(err);
      logger.error(`[roll] roll failed: ${code ?? String(err)}`);
      await privateNote(body, rollFailedMessage(err), logger);
    }
  };
}
