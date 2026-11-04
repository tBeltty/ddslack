import type { AllMiddlewareArgs, SlackEventMiddlewareArgs } from '@slack/bolt';
import { isExplicitMention, RecentKeys, replyThreadTs } from '../../lib/invocation.js';
import { LAUNCHER_FALLBACK, launcherBlocks } from '../../lib/messages.js';
import type { RollTarget } from '../../lib/target.js';
import type { ListenerOptions } from '../options.js';

const handledMentions = new RecentKeys();

/** Mention in a channel, thread or Huddle chat: reply in that thread with the dice buttons. */
export function appMention({ table }: ListenerOptions) {
  return async ({
    event,
    context,
    client,
    logger,
  }: AllMiddlewareArgs & SlackEventMiddlewareArgs<'app_mention'>): Promise<void> => {
    if (!isExplicitMention(event, context.botUserId)) return;
    if (handledMentions.seen(`${event.channel}:${event.ts}`)) return;

    logger.info(`[interaction] app_mention channel=${event.channel} in_thread=${Boolean(event.thread_ts)}`);
    const threadTs = replyThreadTs(event);
    const target: RollTarget = { channel: event.channel, ...(threadTs ? { threadTs } : {}) };

    const picker = await client.chat.postMessage({
      channel: event.channel,
      thread_ts: threadTs,
      text: LAUNCHER_FALLBACK,
      blocks: launcherBlocks(target),
    });
    if (picker.ts) table.rememberPicker(target, picker.ts);
  };
}
