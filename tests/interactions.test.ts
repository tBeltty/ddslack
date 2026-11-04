// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { describeInteraction } from '../listeners/interactions.js';

describe('interaction log line', () => {
  it('names the action, channel and message kind, without the person or their text', () => {
    const line = describeInteraction({
      type: 'block_actions',
      user: { id: 'U123SECRET', name: 'ana' },
      actions: [{ action_id: 'open_roll_modal' }],
      channel: { id: 'C1' },
      container: { type: 'message', is_ephemeral: true },
    } as never);
    expect(line).toBe('action=open_roll_modal channel=C1 container=message ephemeral');
    expect(line).not.toContain('U123SECRET');
  });

  it('names the submitted form', () => {
    expect(describeInteraction({ type: 'view_submission', view: { callback_id: 'roll_modal' } } as never)).toBe(
      'view_submission callback=roll_modal'
    );
  });

  it('stays quiet for events and commands', () => {
    expect(describeInteraction({ type: 'event_callback' } as never)).toBeNull();
    expect(describeInteraction({ command: '/roll' } as never)).toBeNull();
  });
});
