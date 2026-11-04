// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { parseDice, rollTerms, type Rng } from '../lib/dice.js';
import { escapeMrkdwn, formatRoll, launcherBlocks, readRollForm, rollModal } from '../lib/messages.js';
import { decodeTarget } from '../lib/target.js';

const fixed = (...values: number[]): Rng => {
  let i = 0;
  return () => values[i++] ?? 1;
};

function roll(expr: string, ...values: number[]) {
  const parsed = parseDice(expr);
  if (!parsed.ok) throw new Error(parsed.error);
  return { terms: parsed.terms, result: rollTerms(parsed.terms, fixed(...values)) };
}

describe('formatRoll', () => {
  it('shows every die, strikes the dropped ones and marks a natural 20', () => {
    const text = formatRoll({ userId: 'U1', ...roll('2d20kh1+5', 20, 3), reason: 'Ataque' });
    expect(text).toBe('<@U1> rolled `2d20kh1+5` (Ataque): [20, ~3~] + 5 = *25*  *Natural 20!*');
  });

  it('labels secret rolls', () => {
    const text = formatRoll({ userId: 'U1', ...roll('1d6', 4), secret: true });
    expect(text.startsWith('Only you can see this roll.\n')).toBe(true);
  });

  it('cannot be used to ping the channel through the reason', () => {
    const text = formatRoll({ userId: 'U1', ...roll('1d6', 4), reason: '<!channel> &lt;!here&gt;' });
    expect(text).not.toMatch(/<!channel>|<!here>/);
  });
});

describe('escapeMrkdwn', () => {
  it('escapes once, even if Slack already escaped the text', () => {
    expect(escapeMrkdwn('a &amp; b <x>')).toBe('a &amp; b &lt;x&gt;');
  });
});

describe('launcher and modal keep the Huddle thread as destination', () => {
  const target = { channel: 'C1', threadTs: '1700000000.000100' };

  it('stores the thread in the button value', () => {
    const actions = launcherBlocks(target).find((b) => b.type === 'actions');
    const elements = actions && 'elements' in actions ? (actions.elements as Array<{ type: string; value?: string }>) : [];
    const button = elements.find((e) => e.type === 'button');
    expect(decodeTarget(button?.value)).toEqual(target);
  });

  it('stores the thread in the modal metadata', () => {
    expect(decodeTarget(rollModal(target).private_metadata)).toEqual(target);
  });
});

describe('readRollForm', () => {
  const values = (o: { die?: string; count?: string; modifier?: string; mode?: string; secret?: boolean }) => ({
    die: { value: { selected_option: { value: o.die ?? '20' } } },
    count: { value: { value: o.count ?? '1' } },
    modifier: { value: { value: o.modifier ?? '0' } },
    type: { value: { selected_option: { value: o.mode ?? 'normal' } } },
    reason: { value: { value: 'Sigilo' } },
    secret: { value: { selected_options: o.secret ? [{ value: 'secret' }] : [] } },
  });

  it('turns the form into an expression', () => {
    expect(readRollForm(values({ mode: 'advantage', modifier: '4', secret: true }))).toEqual({
      ok: true,
      expression: '2d20kh1+4',
      reason: 'Sigilo',
      secret: true,
      critical: false,
    });
  });

  it('rejects advantage on anything but 1d20', () => {
    const form = readRollForm(values({ die: '6', mode: 'advantage' }));
    expect(form.ok).toBe(false);
    if (!form.ok) expect(form.errors.type).toBeDefined();
  });
});

describe('decodeTarget', () => {
  it.each([
    ['not json'],
    [JSON.stringify({ threadTs: '1.0' })],
    [JSON.stringify({ channel: 'C1', threadTs: 'nope' })],
    [JSON.stringify({ channel: 'C1', responseUrl: 'https://evil.example/hook' })],
  ])('rejects %s', (raw) => {
    expect(decodeTarget(raw)).toBeNull();
  });
});
