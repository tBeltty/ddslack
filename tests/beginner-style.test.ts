import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Rng } from '../lib/dice.js';
import { Preferences } from '../lib/preferences.js';
import { performRoll } from '../lib/roll.js';

const sequence = (...values: number[]): Rng => {
  let i = 0;
  return () => values[i++] ?? 1;
};
const beginner = (expression: string, values: number[], extra: { dc?: number; critical?: boolean; reason?: string } = {}) => {
  const roll = performRoll({ expression, userId: 'U1', style: 'beginner', rng: sequence(...values), ...extra });
  if (!roll.ok) throw new Error(roll.error);
  return roll.text;
};

describe('beginner messages', () => {
  it('explain disadvantage in words', () => {
    expect(beginner('2d20kl1', [8, 11])).toBe(
      '<@U1> rolled two d20 with disadvantage: 8 and 11. Disadvantage keeps the lower one: *8*'
    );
  });

  it('explain advantage with a bonus', () => {
    expect(beginner('2d20kh1+3', [8, 11])).toBe(
      '<@U1> rolled two d20 with advantage: 8 and 11. Advantage keeps the higher one: 11. With +3, the total is *14*'
    );
  });

  it('read a single die plainly, with and without a bonus', () => {
    expect(beginner('1d20', [17])).toBe('<@U1> rolled a d20: *17*');
    expect(beginner('1d20+3', [12])).toBe('<@U1> rolled a d20 and got 12. With +3, the total is *15*');
    expect(beginner('1d8-1', [5])).toBe('<@U1> rolled a d8 and got 5. With -1, the total is *4*');
  });

  it('add up a group of dice', () => {
    expect(beginner('2d6', [3, 5])).toBe('<@U1> rolled two d6: 3 + 5 = *8*');
    expect(beginner('2d8+2', [3, 5])).toBe('<@U1> rolled two d8: 3 + 5 = 8. With +2, the total is *10*');
  });

  it('say what a target number means', () => {
    expect(beginner('1d20+3', [12], { dc: 15 })).toBe(
      '<@U1> rolled a d20 and got 12. With +3, the total is *15*. Needed 15 or more: *Success*'
    );
    expect(beginner('1d20', [9], { dc: 10 })).toContain('Needed 10 or more: *Failure*');
  });

  it('explain natural 20 and natural 1', () => {
    expect(beginner('1d20', [20])).toBe('<@U1> rolled a d20: *20*. *Natural 20!* The best possible roll');
    expect(beginner('2d20kl1', [1, 15])).toContain('*Natural 1.* The worst possible roll');
  });

  it('explain keeping the best dice and critical hits', () => {
    expect(beginner('4d6kh3', [6, 5, 4, 1])).toBe(
      '<@U1> rolled four d6: 6, 5, 4 and 1. It keeps the highest three and drops one: *15*'
    );
    expect(beginner('2d8+3', [5, 5], { critical: true, reason: 'Longsword' })).toBe(
      '<@U1> rolled two d8 (critical hit, dice doubled, Longsword): 5 + 5 = 10. With +3, the total is *13*'
    );
  });

  it('fall back to notation for mixed rolls', () => {
    expect(beginner('2d6+1d4', [3, 5, 2])).toBe('<@U1> rolled `2d6+1d4`: [3, 5] + [2] = *10*');
  });

  it('leave expert messages as they were', () => {
    const roll = performRoll({ expression: '2d20kl1', userId: 'U1', style: 'expert', rng: sequence(8, 11) });
    expect(roll.ok && roll.text).toBe('<@U1> rolled `2d20kl1`: [8, ~11~] = *8*');
  });
});

describe('Preferences', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('defaults everyone to beginner', () => {
    expect(new Preferences(null).style('U1')).toBe('beginner');
  });

  it('saves a choice and reads it back after a restart', async () => {
    dir = mkdtempSync(join(tmpdir(), 'prefs-'));
    const first = Preferences.inDirectory(dir);
    await first.setStyle('U1', 'expert');
    expect(Preferences.inDirectory(dir).style('U1')).toBe('expert');
    expect(Preferences.inDirectory(dir).style('U2')).toBe('beginner');
    expect(JSON.parse(readFileSync(join(dir, 'preferences.json'), 'utf8'))).toEqual({ users: { U1: { style: 'expert' } } });
  });

  it('keeps working in memory when the file cannot be written, and says so', async () => {
    // A regular file where the directory should be fails the same way on macOS and Linux.
    dir = mkdtempSync(join(tmpdir(), 'prefs-'));
    writeFileSync(join(dir, 'blocker'), '');
    const warnings: string[] = [];
    const prefs = new Preferences(join(dir, 'blocker', 'preferences.json'), (m) => warnings.push(m));
    await prefs.setStyle('U1', 'expert');
    expect(prefs.style('U1')).toBe('expert');
    expect(warnings.join(' ')).toContain('Styles last until restart');
  });

  it('ignores unknown values in the file', () => {
    dir = mkdtempSync(join(tmpdir(), 'prefs-'));
    writeFileSync(join(dir, 'preferences.json'), JSON.stringify({ users: { U1: { style: 'wizard' } } }));
    expect(Preferences.inDirectory(dir).style('U1')).toBe('beginner');
  });
});
