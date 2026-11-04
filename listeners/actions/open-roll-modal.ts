import type { AllMiddlewareArgs, BlockButtonAction, SlackActionMiddlewareArgs } from '@slack/bolt';
import { type FormValues, readPicker, rollModal } from '../../lib/messages.js';
import { slackErrorCode } from '../../lib/publish.js';
import { targetFromAction } from './action-target.js';
import { privateNote } from './private-note.js';

/** More options: the full form, starting from what the picker is set to. */
export async function openRollModal({
  ack,
  body,
  action,
  client,
  logger,
}: AllMiddlewareArgs & SlackActionMiddlewareArgs<BlockButtonAction>): Promise<void> {
  await ack();
  const target = targetFromAction(body, action.value);
  if (!target) {
    logger.warn('[more_options] no destination in the click');
    return;
  }
  try {
    const choice = readPicker(body.state as { values?: FormValues } | undefined);
    await client.views.open({ trigger_id: body.trigger_id, view: rollModal(target, choice) });
    logger.info('[interaction] more_options opened');
  } catch (err) {
    logger.error(`[more_options] views.open failed: ${slackErrorCode(err) ?? String(err)}`);
    await privateNote(body, 'The form did not open. Please try again, or type `/roll 1d20+5` to roll with a bonus.', logger);
  }
}
