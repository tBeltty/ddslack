import type { App, MessageShortcut } from '@slack/bolt';
import { ROLL_HERE_SHORTCUT } from '../../lib/messages.js';
import { rollHere } from './roll-here.js';

export function register(app: App): void {
  app.shortcut<MessageShortcut>({ callback_id: ROLL_HERE_SHORTCUT, type: 'message_action' }, rollHere);
}
