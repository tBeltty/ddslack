import type { AllMiddlewareArgs, SlackEventMiddlewareArgs } from '@slack/bolt';
import type { ListenerOptions } from '../options.js';

/**
 * A workspace removed the app, or revoked its bot token: forget its installation, so no token
 * of a workspace that left stays on disk.
 */
export function forgetInstallation({ installations }: ListenerOptions) {
  return async ({
    event,
    context,
    logger,
  }: AllMiddlewareArgs & SlackEventMiddlewareArgs<'app_uninstalled' | 'tokens_revoked'>): Promise<void> => {
    if (!installations?.deleteInstallation) return;
    if (event.type === 'tokens_revoked' && (event.tokens.bot ?? []).length === 0) return;
    const query = {
      teamId: context.teamId,
      enterpriseId: context.enterpriseId,
      isEnterpriseInstall: context.isEnterpriseInstall ?? false,
    };
    try {
      await installations.deleteInstallation(query);
      logger.info(`[install] removed the installation of ${context.teamId ?? context.enterpriseId ?? 'unknown'}`);
    } catch (err) {
      logger.error(`[install] could not remove an installation: ${String(err)}`);
    }
  };
}
