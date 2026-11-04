// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cooldown, cooldownMessage, ROLL_COOLDOWN_MS } from '../lib/cooldown.js';
import { encodeTarget } from '../lib/target.js';
import { rollPicker } from '../listeners/actions/roll-picker.js';
import type { ListenerOptions } from '../listeners/options.js';

describe('cooldown between rolls', () => {
  it('lets a person roll once every three seconds', () => {
    let now = 10_000;
    const cooldown = new Cooldown(ROLL_COOLDOWN_MS, () => now);
    expect(cooldown.take('U1')).toEqual({ ok: true });
    now += 1200;
    expect(cooldown.take('U1')).toEqual({ ok: false, waitMs: 1800 });
    now += 1800;
    expect(cooldown.take('U1')).toEqual({ ok: true });
  });

  it('counts each person on their own', () => {
    const cooldown = new Cooldown(ROLL_COOLDOWN_MS, () => 0);
    expect(cooldown.take('U1').ok).toBe(true);
    expect(cooldown.take('U2').ok).toBe(true);
    expect(cooldown.take('U1').ok).toBe(false);
  });

  it('forgets people whose wait is over once many have rolled', () => {
    let now = 0;
    const cooldown = new Cooldown(1000, () => now);
    for (let i = 0; i < 1000; i++) cooldown.take(`U${i}`);
    now = 5000;
    cooldown.take('U-new');
    expect((cooldown as unknown as { last: Map<string, number> }).last.size).toBe(1);
  });

  it('tells how many whole seconds are left', () => {
    expect(cooldownMessage(1800)).toBe('You can roll again in 2 seconds.');
    expect(cooldownMessage(400)).toBe('You can roll again in 1 second.');
  });
});

describe('the Roll button under the cooldown', () => {
  afterEach(() => vi.unstubAllGlobals());

  const click = (values: Record<string, string>) =>
    ({
      ack: async () => {},
      logger: { error: () => {}, warn: () => {}, info: () => {} },
      action: { type: 'button', action_id: 'roll', value: encodeTarget({ channel: 'C1', threadTs: '1700000000.000100' }) },
      body: {
        type: 'block_actions',
        user: { id: 'U1' },
        response_url: 'https://hooks.slack.com/actions/T/1/x',
        container: {},
        state: {
          values: {
            dice: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { selected_option: { value: v } }])),
          },
        },
      },
    }) as never;

  it('rolls once, then answers privately until the wait is over', async () => {
    const notes: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      notes.push(JSON.parse(init.body).text);
      return { ok: true };
    });
    const rolls: string[] = [];
    let now = 0;
    const handler = rollPicker({
      table: { roll: async (o: { expression: string }) => void rolls.push(o.expression) },
      cooldown: new Cooldown(ROLL_COOLDOWN_MS, () => now),
    } as unknown as ListenerOptions);

    await handler(click({ die: '8', modifier: '2' }));
    await handler(click({ die: '8' }));
    now = 3000;
    await handler(click({ die: '6' }));

    expect(rolls).toEqual(['1d8+2', '1d6']);
    expect(notes).toEqual(['You can roll again in 3 seconds.']);
  });

  it('does not start the wait for a type that does not fit the die', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true }));
    const rolls: string[] = [];
    const handler = rollPicker({
      table: { roll: async (o: { expression: string }) => void rolls.push(o.expression) },
      cooldown: new Cooldown(ROLL_COOLDOWN_MS, () => 0),
    } as unknown as ListenerOptions);

    await handler(click({ die: '6', roll_type: 'advantage' }));
    await handler(click({ die: '6' }));
    expect(rolls).toEqual(['1d6']);
  });
});
