import type { App, BlockAction, BlockButtonAction, OverflowAction, RadioButtonsAction } from '@slack/bolt';
import { MESSAGE_STYLE_ACTION } from '../../lib/home.js';
import {
  D20_MODE_ACTION,
  DICE_COUNT_ACTION,
  DIE_ACTION,
  MODIFIER_ACTION,
  OPEN_ROLL_MODAL,
  ROLL_ACTION,
  ROLL_DIE_ACTION,
  ROLL_TYPE_ACTION,
  SPECIAL_ROLL_ACTION,
} from '../../lib/messages.js';
import type { ListenerOptions } from '../options.js';
import { messageStyle } from './message-style.js';
import { openRollModal } from './open-roll-modal.js';
import { rollDie } from './roll-die.js';
import { rollPicker } from './roll-picker.js';
import { specialRoll } from './special-roll.js';

export function register(app: App, options: ListenerOptions): void {
  app.action(OPEN_ROLL_MODAL, openRollModal);
  // The menus only set what the next Roll click reads; nothing to do.
  for (const selector of [DIE_ACTION, DICE_COUNT_ACTION, MODIFIER_ACTION, ROLL_TYPE_ACTION, D20_MODE_ACTION]) {
    app.action(selector, async ({ ack }) => {
      await ack();
    });
  }
  app.action<BlockAction<OverflowAction>>({ type: 'block_actions', action_id: SPECIAL_ROLL_ACTION }, specialRoll(options));
  app.action<BlockAction<RadioButtonsAction>>(
    { type: 'block_actions', action_id: MESSAGE_STYLE_ACTION },
    messageStyle(options)
  );
  app.action<BlockButtonAction>({ type: 'block_actions', action_id: ROLL_ACTION }, rollPicker(options));
  app.action<BlockButtonAction>({ type: 'block_actions', action_id: ROLL_DIE_ACTION }, rollDie(options));
}
