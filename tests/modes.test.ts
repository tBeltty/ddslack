import { describe, expect, it } from 'vitest';
import type { Rng } from '../lib/dice.js';
import {
  choiceExpression,
  diceButtonsBlock,
  legacyPickerExpression,
  parseSpecialRoll,
  readPicker,
  readRollForm,
  rollModal,
  rollTypeProblem,
} from '../lib/messages.js';
import { abilityScoresView, deathSaveView, performRoll } from '../lib/roll.js';

const always = (value: number): Rng => () => value;
const sequence = (...values: number[]): Rng => {
  let i = 0;
  return () => values[i++] ?? 1;
};
const BASE = 'https://ddslack.tbelt.online';
const TARGET = { channel: 'C1', threadTs: '1700000000.000100' };

const state = (o: { die?: string; count?: string; modifier?: string; type?: string; mode?: string }) => {
  const pick = (value?: string) => ({ selected_option: value ? { value } : null });
  return {
    values: {
      dice: {
        die: pick(o.die),
        dice_count: pick(o.count),
        modifier: pick(o.modifier),
        roll_type: pick(o.type),
        d20_mode: pick(o.mode),
      },
    },
  };
};

const roll = (o: Parameters<typeof state>[0]) => {
  const choice = readPicker(state(o));
  return rollTypeProblem(choice) ?? choiceExpression(choice);
};

describe('dice picker', () => {
  const elements = () => (diceButtonsBlock(TARGET) as unknown as { elements: Array<Record<string, unknown>> }).elements;

  it('lays out die, how many, modifier and type menus, then Roll, More options and the special rolls', () => {
    expect(elements().map((e) => e.action_id)).toEqual([
      'die',
      'dice_count',
      'modifier',
      'roll_type',
      'roll',
      'open_roll_modal',
      'special_roll',
    ]);
    const [die, count, modifier, type, rollButton] = elements();
    expect(die).toMatchObject({ type: 'static_select', initial_option: { value: '20' } });
    expect((die?.options as Array<{ value: string }> | undefined ?? []).map((o) => o.value)).toEqual(['4', '6', '8', '10', '12', '20', '100']);
    expect(count).toMatchObject({ initial_option: { value: '1' } });
    expect(modifier).toMatchObject({ initial_option: { value: '0', text: { text: 'No modifier' } } });
    const modifiers = modifier?.options as Array<{ value: string; text: { text: string } }>;
    expect(modifiers.at(0)).toMatchObject({ value: '-5', text: { text: '-5 modifier' } });
    expect(modifiers.at(-1)).toMatchObject({ value: '20', text: { text: '+20 modifier' } });
    expect((type?.options as Array<{ value: string }> | undefined ?? []).map((o) => o.value)).toEqual([
      'normal',
      'advantage',
      'disadvantage',
      'critical',
    ]);
    expect(rollButton).toMatchObject({ type: 'button', style: 'primary', text: { text: 'Roll' } });
    const menu = elements().at(-1) as { type: string; options: Array<{ value: string }> };
    expect(menu.type).toBe('overflow');
    expect(menu.options.map((o) => o.value.split('|')[0])).toEqual(['stats', 'death']);
    // Slack caps an option value at 150 characters.
    for (const option of menu.options) expect(option.value.length).toBeLessThanOrEqual(150);
  });

  it('keeps every select label short enough for Slack not to cut it', () => {
    for (const e of elements().filter((e) => e.type === 'static_select')) {
      for (const o of (e.options as Array<{ text: { text: string } }> | undefined) ?? []) {
        expect(o.text.text.length).toBeLessThanOrEqual(14);
      }
    }
  });

  it('rolls one d20 when nothing was changed', () => {
    expect(roll({})).toBe('1d20');
  });

  it('adds the modifier to any roll', () => {
    expect(roll({ die: '8', count: '2', modifier: '3' })).toBe('2d8+3');
    expect(roll({ modifier: '-1' })).toBe('1d20-1');
    expect(roll({ type: 'advantage', modifier: '5' })).toBe('2d20kh1+5');
  });

  it('rolls advantage and disadvantage as two d20 keeping one', () => {
    expect(roll({ type: 'advantage' })).toBe('2d20kh1');
    expect(roll({ type: 'disadvantage' })).toBe('2d20kl1');
  });

  it('doubles the damage dice on a critical hit, not the modifier', () => {
    expect(roll({ die: '6', count: '2', modifier: '3', type: 'critical' })).toBe('4d6+3');
  });

  it('explains a type that does not fit the dice instead of rolling', () => {
    expect(roll({ die: '6', type: 'advantage' })).toContain('apply to the d20');
    expect(roll({ count: '2', type: 'disadvantage' })).toContain('choose 1 die');
    expect(roll({ type: 'critical' })).toContain('damage die');
  });

  it('falls back to the default for anything unexpected', () => {
    expect(readPicker(state({ die: '7', count: '11', modifier: '99', type: 'lucky' }))).toEqual({
      sides: 20,
      count: 1,
      modifier: 0,
      type: 'normal',
    });
    expect(readPicker(undefined)).toEqual({ sides: 20, count: 1, modifier: 0, type: 'normal' });
  });

  it('keeps the die buttons of older pickers working', () => {
    expect(legacyPickerExpression(20, state({ mode: 'advantage', count: '3' }))).toBe('2d20kh1');
    expect(legacyPickerExpression(20, state({ count: '2' }))).toBe('2d20');
    expect(legacyPickerExpression(6, state({ mode: 'advantage', count: '2' }))).toBe('2d6');
  });

  it('reads the special roll and its destination from the menu', () => {
    expect(parseSpecialRoll('death|{"channel":"C1"}')).toEqual({ kind: 'death', target: '{"channel":"C1"}' });
    expect(parseSpecialRoll('steal|{}')).toBeNull();
  });

  it('opens More options with what the picker is set to', () => {
    const view = JSON.stringify(rollModal(TARGET, { sides: 8, count: 2, modifier: 3, type: 'critical' }));
    expect(view).toContain('"initial_option":{"text":{"type":"plain_text","text":"d8"},"value":"8"}');
    expect(view).toContain('"initial_value":"2"');
    expect(view).toContain('"initial_value":"3"');
    expect(view).toContain('"initial_option":{"text":{"type":"plain_text","text":"Critical hit"},"value":"critical"}');
  });
});

describe('target number', () => {
  it('says Success when the total meets the DC and Failure below it', () => {
    const hit = performRoll({ expression: '1d20+3', userId: 'U1', dc: 15, rng: always(12) });
    const miss = performRoll({ expression: '1d20+3', userId: 'U1', dc: 15, rng: always(11) });
    expect(hit.ok && hit.text).toBe('<@U1> rolled `1d20+3`: [12] + 3 = *15* vs 15: *Success*');
    expect(miss.ok && miss.text).toContain('= *14* vs 15: *Failure*');
  });
});

describe('critical hit', () => {
  const form = (o: { count?: string; critical?: boolean; mode?: string; dc?: string }) =>
    readRollForm({
      die: { value: { selected_option: { value: '8' } } },
      count: { value: { value: o.count ?? '1' } },
      modifier: { value: { value: '3' } },
      type: { value: { selected_option: { value: o.critical ? 'critical' : (o.mode ?? 'normal') } } },
      dc: { value: { value: o.dc ?? null } },
      reason: { value: { value: '' } },
      secret: { value: { selected_options: [] } },
    });

  it('doubles the dice but not the bonus', () => {
    expect(form({ critical: true })).toMatchObject({ ok: true, expression: '2d8+3', critical: true });
    expect(form({ count: '2', critical: true })).toMatchObject({ expression: '4d8+3' });
  });

  it('labels the roll as a critical hit', () => {
    const roll = performRoll({ expression: '2d8+3', userId: 'U1', critical: true, reason: 'Longsword', rng: always(5) });
    expect(roll.ok && roll.text).toBe('<@U1> rolled `2d8+3` (critical hit, Longsword): [5, 5] + 3 = *13*');
  });

  it('refuses combinations that make no sense', () => {
    expect(form({ critical: true, count: '51' })).toMatchObject({ ok: false });
    expect(form({ dc: '0' })).toMatchObject({ ok: false });
  });

  it('passes an optional target number through', () => {
    expect(form({ dc: '15' })).toMatchObject({ ok: true, dc: 15 });
    expect(form({})).not.toHaveProperty('dc');
  });
});

describe('death saving throw', () => {
  it.each([
    [1, 'Two failures'],
    [9, 'Failure'],
    [10, 'Success'],
    [20, 'You regain 1 hit point'],
  ])('reads %i as %s', (value, outcome) => {
    const view = deathSaveView({ userId: 'U1', publicBaseUrl: BASE, rng: always(value) });
    expect(view.instant.text).toBe(`<@U1> rolled a death saving throw: *${value}*. ${outcome}.`);
    expect(view.rolling.text).toBe('<@U1> is rolling a death saving throw…');
  });

  it('celebrates a natural 20 like any d20 check', () => {
    const view = deathSaveView({ userId: 'U1', publicBaseUrl: BASE, rng: always(20) });
    expect(view.natural).toBe(20);
    expect(JSON.stringify(view.reveal(TARGET).blocks)).toContain('d20-20-large.png');
  });
});

describe('ability scores', () => {
  it('rolls 4d6 keeping the highest three, six times', () => {
    // Each set of four: the lowest die is dropped.
    const rng = sequence(6, 5, 4, 1, 3, 3, 3, 3, 6, 6, 6, 6, 1, 1, 1, 2, 4, 2, 5, 3, 6, 1, 2, 5);
    const view = abilityScoresView({ userId: 'U1', publicBaseUrl: BASE, rng });
    expect(view.instant.text).toBe('<@U1> rolled ability scores: *15*, *9*, *18*, *4*, *12*, *13* (total 71)');
    expect(JSON.stringify(view.instant.blocks)).toContain('[6, 5, 4, ~1~] = 15');
    expect(view.rolling.text).toBe('<@U1> is rolling ability scores…');
    expect(view.natural).toBeNull();
    expect(JSON.stringify(view.reveal(TARGET).blocks)).toContain('"action_id":"roll"');
  });
});
