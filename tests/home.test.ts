import { describe, expect, it } from 'vitest';
import { homeView } from '../lib/home.js';

describe('App Home tab', () => {
  const view = homeView('U123', 'beginner');
  const text = JSON.stringify(view.blocks);

  it('greets the person who opened it', () => {
    expect(text).toContain('Hi <@U123>');
  });

  it('shows the message style setting with the current choice selected', () => {
    const accessory = (homeView('U123', 'expert').blocks as Array<{ accessory?: { type: string; initial_option?: { value: string } } }>)
      .map((b) => b.accessory)
      .find((a) => a?.type === 'radio_buttons');
    expect(accessory?.initial_option?.value).toBe('expert');
    expect(text).toContain('Message style');
  });

  it('stays within the 100-block limit of a Home view', () => {
    expect(view.type).toBe('home');
    expect(view.blocks.length).toBeLessThanOrEqual(100);
  });

  it('explains every way to roll and the SRD damage examples', () => {
    for (const phrase of ['/roll 1d20+5 attack', '/roll stats', '/roll death', 'More options', '/invite @Nat20']) {
      expect(text).toContain(phrase);
    }
    expect(text).toContain('dagger 1d4, shortsword 1d6, longsword 1d8, greataxe 1d12, greatsword 2d6, fireball 8d6');
  });
});
