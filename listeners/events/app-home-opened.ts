import type { AllMiddlewareArgs, SlackEventMiddlewareArgs } from '@slack/bolt';
import { homeView } from '../../lib/home.js';
import { slackErrorCode } from '../../lib/publish.js';
import type { ListenerOptions } from '../options.js';

/** Publishes the guide, with the person's message style, whenever they open the Home tab. */
export function appHomeOpened({ preferences }: ListenerOptions) {
  return async ({
    event,
    client,
    logger,
  }: AllMiddlewareArgs & SlackEventMiddlewareArgs<'app_home_opened'>): Promise<void> => {
    if (event.tab !== 'home') return;
    try {
      await client.views.publish({ user_id: event.user, view: homeView(event.user, preferences.style(event.user)) });
    } catch (err) {
      logger.error(`[app_home] publish failed: ${slackErrorCode(err) ?? String(err)}`);
    }
  };
}
