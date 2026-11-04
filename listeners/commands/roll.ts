import type { AllMiddlewareArgs, SlackCommandMiddlewareArgs } from '@slack/bolt';
import { cooldownMessage } from '../../lib/cooldown.js';
import { parseDice, splitRollText } from '../../lib/dice.js';
import { escapeMrkdwn, HELP_TEXT, LAUNCHER_FALLBACK, launcherBlocks } from '../../lib/messages.js';
import { rollFailedMessage, slackErrorCode } from '../../lib/publish.js';
import { abilityScoresView, deathSaveView } from '../../lib/roll.js';
import { type ListenerOptions, tokenOf } from '../options.js';

/**
 * `/roll` answers in the channel where it was typed. With no text it shows the dice
 * picker only to the person who typed it; each roll is posted in the channel.
 */
export function roll({ table, publicBaseUrl, cooldown }: ListenerOptions) {
  return async ({
    ack,
    command,
    respond,
    logger,
    context,
  }: AllMiddlewareArgs & SlackCommandMiddlewareArgs): Promise<void> => {
    logger.info(`[interaction] /roll channel=${command.channel_id}`);

    const text = command.text.trim();
    if (!text) {
      await ack({
        response_type: 'ephemeral',
        text: LAUNCHER_FALLBACK,
        blocks: launcherBlocks({ channel: command.channel_id }),
      });
      return;
    }

    const keyword = text.toLowerCase();
    const special = keyword === 'stats' || keyword === 'death';
    const split = special ? null : splitRollText(text);
    if (!special && !split) {
      const parsed = parseDice(text.split(/\s+/)[0] ?? '');
      const error = parsed.ok ? '' : `${escapeMrkdwn(parsed.error)}\n\n`;
      await ack({ response_type: 'ephemeral', text: `${error}${HELP_TEXT}` });
      return;
    }
    const turn = cooldown.take(command.user_id);
    if (!turn.ok) {
      await ack({ response_type: 'ephemeral', text: cooldownMessage(turn.waitMs) });
      return;
    }

    if (special) {
      await ack();
      const base = { userId: command.user_id, ...(publicBaseUrl ? { publicBaseUrl } : {}) };
      try {
        await table.roll({
          ...tokenOf(context),
          target: { channel: command.channel_id },
          userId: command.user_id,
          view: keyword === 'stats' ? abilityScoresView(base) : deathSaveView(base),
          fallbackResponseUrl: command.response_url,
        });
      } catch (err) {
        logger.error(`[/roll] ${keyword} failed: ${slackErrorCode(err) ?? String(err)}`);
        await respond({ response_type: 'ephemeral', text: rollFailedMessage(err) });
      }
      return;
    }

    // Always set by now: the checks above answered every other case.
    if (!split) return;
    await ack();
    try {
      await table.roll({
        ...tokenOf(context),
        target: { channel: command.channel_id },
        userId: command.user_id,
        expression: split.expression,
        reason: split.reason,
        fallbackResponseUrl: command.response_url,
      });
    } catch (err) {
      logger.error(`[/roll] roll failed: ${slackErrorCode(err) ?? String(err)}`);
      await respond({ response_type: 'ephemeral', text: rollFailedMessage(err) });
    }
  };
}
