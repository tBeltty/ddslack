// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BlockAction, ButtonAction } from '@slack/bolt';
import { describe, expect, it } from 'vitest';
import { readConfig } from '../lib/config.js';
import { STANDARD_DICE, singleDieFace, splitRollText, parseDice, rollTerms, type Rng } from '../lib/dice.js';
import {
  launcherBlocks,
  parseRollDieActionId,
  readDiceCount,
  rollDieActionId,
  rollingBlocks,
} from '../lib/messages.js';
import { performRoll } from '../lib/roll.js';
import { encodeTarget } from '../lib/target.js';
import { targetFromAction } from '../listeners/actions/action-target.js';

const always = (value: number): Rng => () => value;
const BASE = 'https://ddslack.tbelt.online';

type Element = {
  type: string;
  action_id: string;
  text?: { text: string };
  style?: string;
  options?: Array<{ value: string; text: { text: string } }>;
  initial_option?: { value: string };
};

function elements(): Element[] {
  const actions = launcherBlocks({ channel: 'C1', threadTs: '1.000001' }).find((b) => b.type === 'actions');
  if (!actions || !('elements' in actions)) throw new Error('no actions block');
  return actions.elements as Element[];
}

const buttons = () => elements().filter((e) => e.type === 'button');

describe('dice picker', () => {
  it('offers one Roll button, highlighted, then More options', () => {
    expect(buttons().map((b) => b.text?.text)).toEqual(['Roll', 'More options']);
    expect(buttons()[0]?.style).toBe('primary');
  });

  it('has a count selector from 1 to 10 dice, set to 1', () => {
    const select = elements().find((e) => e.action_id === 'dice_count');
    expect(select?.options?.map((o) => o.value)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    expect(select?.options?.[1]?.text.text).toBe('2 dice');
    expect(select?.initial_option?.value).toBe('1');
  });

  it('reads the chosen count from the click, defaulting to 1', () => {
    const state = (value?: string) => ({
      values: { dice: { dice_count: { selected_option: value ? { value } : null } } },
    });
    expect(readDiceCount(state('3'))).toBe(3);
    expect(readDiceCount(state())).toBe(1);
    expect(readDiceCount(undefined)).toBe(1);
    expect(readDiceCount(state('11'))).toBe(1);
    expect(readDiceCount(state('two'))).toBe(1);
  });

  it('maps every older die button back to its die and nothing else', () => {
    for (const sides of STANDARD_DICE) expect(parseRollDieActionId(rollDieActionId(sides))).toBe(sides);
    expect(parseRollDieActionId('roll_d7')).toBeNull();
    expect(parseRollDieActionId('roll_d1000')).toBeNull();
    expect(parseRollDieActionId('open_roll_modal')).toBeNull();
  });
});

describe('beginner roll message', () => {
  it('reads as plain words for one die and shows its face', () => {
    const roll = performRoll({ expression: '1d20', userId: 'U1', publicBaseUrl: BASE, rng: always(17) });
    if (!roll.ok) throw new Error(roll.error);
    expect(roll.message.text).toBe('<@U1> rolled a d20: *17*');
    expect(roll.message.blocks[0]).toMatchObject({
      accessory: { type: 'image', image_url: `${BASE}/dice/v2/d20-17.png`, alt_text: 'd20 showing 17' },
    });
  });

  it('keeps the natural 20 note', () => {
    const roll = performRoll({ expression: '1d20', userId: 'U1', rng: always(20) });
    expect(roll.ok && roll.message.text).toBe('<@U1> rolled a d20: *20*  *Natural 20!*');
  });

  it('shows both advantage dice, the dropped one faded, and keeps the full detail', () => {
    let i = 0;
    const roll = performRoll({
      expression: '2d20kh1+3',
      userId: 'U1',
      publicBaseUrl: BASE,
      rng: () => [4, 15][i++] ?? 1,
    });
    if (!roll.ok) throw new Error(roll.error);
    expect(roll.message.text).toContain('[~4~, 15] + 3 = *18*');
    expect(roll.message.blocks[1]).toMatchObject({
      type: 'image',
      image_url: `${BASE}/dice/v2/strip/d20-4x_d20-15.png`,
      alt_text: 'd20 4 (dropped), d20 15',
    });
  });

  it('reads a group of dice as a plain sum and shows them in a row', () => {
    let i = 0;
    const roll = performRoll({ expression: '2d6', userId: 'U1', publicBaseUrl: BASE, rng: () => [3, 5][i++] ?? 1 });
    if (!roll.ok) throw new Error(roll.error);
    expect(roll.message.text).toBe('<@U1> rolled 2d6: 3 + 5 = *8*');
    expect(roll.message.blocks[1]).toMatchObject({ type: 'image', image_url: `${BASE}/dice/v2/strip/d6-3_d6-5.png` });
  });

  it('shows three dice and a badge for the rest, with every value in the text', () => {
    let i = 0;
    const values = [1, 2, 3, 4, 5, 6, 1, 2];
    const roll = performRoll({ expression: '8d6', userId: 'U1', publicBaseUrl: BASE, rng: () => values[i++] ?? 1 });
    if (!roll.ok) throw new Error(roll.error);
    expect(roll.message.text).toBe('<@U1> rolled 8d6: 1 + 2 + 3 + 4 + 5 + 6 + 1 + 2 = *24*');
    expect(roll.message.blocks[1]).toMatchObject({
      image_url: `${BASE}/dice/v2/strip/d6-1_d6-2_d6-3_m5.png`,
      alt_text: 'd6 1, d6 2, d6 3 and 5 more',
    });
  });

  it('posts text only without a public base URL or with several dice', () => {
    const noBase = performRoll({ expression: '1d6', userId: 'U1', rng: always(3) });
    const many = performRoll({ expression: '2d6', userId: 'U1', publicBaseUrl: BASE, rng: always(3) });
    expect(noBase.ok && 'accessory' in (noBase.message.blocks[0] ?? {})).toBe(false);
    expect(many.ok && 'accessory' in (many.message.blocks[0] ?? {})).toBe(false);
  });

  it('has no image for a non-standard die', () => {
    const parsed = parseDice('1d7');
    if (!parsed.ok) throw new Error(parsed.error);
    expect(singleDieFace(rollTerms(parsed.terms, always(5)))).toEqual({ sides: 7, value: 5 });
    const roll = performRoll({ expression: '1d7', userId: 'U1', publicBaseUrl: BASE, rng: always(5) });
    expect(roll.ok && 'accessory' in (roll.message.blocks[0] ?? {})).toBe(false);
  });
});

describe('rolling animation', () => {
  const terms = (expr: string) => {
    const parsed = parseDice(expr);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.terms;
  };

  it('puts one tumbling die next to the text', () => {
    const { text, blocks } = rollingBlocks({ userId: 'U1', terms: terms('1d20'), publicBaseUrl: BASE });
    expect(text).toBe('<@U1> is rolling a d20…');
    expect(blocks[0]).toMatchObject({ accessory: { image_url: `${BASE}/dice/v2/d20-rolling.gif` } });
  });

  it('shows as many tumbling dice as were rolled, up to three', () => {
    const two = rollingBlocks({ userId: 'U1', terms: terms('2d6'), publicBaseUrl: BASE });
    const eight = rollingBlocks({ userId: 'U1', terms: terms('8d6'), publicBaseUrl: BASE });
    expect(two.text).toBe('<@U1> is rolling 2d6…');
    expect(two.blocks[1]).toMatchObject({ type: 'image', image_url: `${BASE}/dice/v2/d6-rolling-2.gif` });
    expect(eight.blocks[1]).toMatchObject({ type: 'image', image_url: `${BASE}/dice/v2/d6-rolling-3.gif` });
  });
});

describe('/roll shorthand', () => {
  it('reads a bare standard die size as one die', () => {
    expect(splitRollText('20')).toEqual({ expression: 'd20', reason: '' });
    expect(splitRollText('6 fire damage')).toEqual({ expression: 'd6', reason: 'fire damage' });
  });

  it('does not invent dice from other numbers', () => {
    expect(splitRollText('7')).toBeNull();
  });
});

describe('PUBLIC_BASE_URL', () => {
  const tokens = { SLACK_BOT_TOKEN: 'xoxb-dummy', SLACK_APP_TOKEN: 'xapp-dummy' };
  const base = (value: string) => {
    const loaded = readConfig({ ...tokens, PUBLIC_BASE_URL: value });
    return loaded.ok ? loaded.config.publicBaseUrl : 'invalid';
  };

  it('accepts an https origin, with or without a trailing slash', () => {
    expect(base('https://ddslack.tbelt.online')).toBe(BASE);
    expect(base('https://ddslack.tbelt.online/')).toBe(BASE);
  });

  it.each(['http://ddslack.tbelt.online', 'https://ddslack.tbelt.online/dice', 'not a url', 'https://u:p@x.online'])(
    'ignores %s',
    (value) => {
      expect(base(value)).toBeUndefined();
    }
  );
});

describe('where a die button posts', () => {
  const action = (target: object) => ({ type: 'button', action_id: 'roll_d20', value: encodeTarget(target as never) }) as ButtonAction;
  const body = (extra: object) =>
    ({ type: 'block_actions', response_url: 'https://hooks.slack.com/actions/T/1/x', container: {}, ...extra }) as unknown as BlockAction;

  it('posts in the thread of a bot picker, such as a Huddle chat', () => {
    const target = { channel: 'C1', threadTs: '1700000000.000100' };
    expect(targetFromAction(body({}), action(target).value)).toEqual(target);
  });

  it('answers through the response URL from an ephemeral /roll picker', () => {
    expect(targetFromAction(body({ container: { is_ephemeral: true } }), action({ channel: 'C1' }).value)).toEqual({
      channel: 'C1',
      responseUrl: 'https://hooks.slack.com/actions/T/1/x',
    });
  });
});
