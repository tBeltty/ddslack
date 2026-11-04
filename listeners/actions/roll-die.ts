import type { AllMiddlewareArgs, BlockButtonAction, SlackActionMiddlewareArgs } from '@slack/bolt';
import { cooldownMessage } from '../../lib/cooldown.js';
import { type FormValues, legacyPickerExpression, parseRollDieActionId } from '../../lib/messages.js';
import { rollFailedMessage, slackErrorCode } from '../../lib/publish.js';
import { type ListenerOptions, tokenOf } from '../options.js';
import { targetFromAction } from './action-target.js';
import { privateNote } from './private-note.js';

/**
 * The die buttons of pickers posted before the die menu: they stay in older messages, so
 * they keep rolling their die, as many as the count, with the d20 mode on the d20.
 */
export function rollDie({ table, cooldown }: ListenerOptions) {
  return async ({
    ack,
    body,
    action,
    logger,
    context,
  }: AllMiddlewareArgs & SlackActionMiddlewareArgs<BlockButtonAction>): Promise<void> => {
    await ack();
    const sides = parseRollDieActionId(action.action_id);
    const target = targetFromAction(body, action.value);
    if (!sides || !target) return;
    const turn = cooldown.take(body.user.id);
    if (!turn.ok) {
      await privateNote(body, cooldownMessage(turn.waitMs), logger);
      return;
    }

    const expression = legacyPickerExpression(sides, body.state as { values?: FormValues } | undefined);
    try {
      await table.roll({
        ...tokenOf(context),
        target,
        userId: body.user.id,
        expression,
        ...(target.responseUrl ? { fallbackResponseUrl: target.responseUrl } : {}),
      });
    } catch (err) {
      const code = slackErrorCode(err);
      logger.error(`[roll_die] roll failed: ${code ?? String(err)}`);
      await privateNote(body, rollFailedMessage(err), logger);
    }
  };
}
