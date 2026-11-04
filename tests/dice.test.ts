import { describe, expect, it } from 'vitest';
import {
  buildExpression,
  formatNotation,
  naturalD20,
  parseDice,
  rollTerms,
  secureRng,
  splitRollText,
  type Rng,
} from '../lib/dice.js';

const sequence = (...values: number[]): Rng => {
  let i = 0;
  return () => values[i++] ?? 1;
};

const terms = (expr: string) => {
  const parsed = parseDice(expr);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.terms;
};

describe('parseDice', () => {
  it.each([
    ['1d20+5', '1d20+5'],
    ['d20', '1d20'],
    ['2d6 + 1d4 - 1', '2d6+1d4-1'],
    ['2d20kh1+3', '2d20kh1+3'],
    ['2D20KL1', '2d20kl1'],
    ['4d6kh3', '4d6kh3'],
    ['1d%', '1d100'],
    ['-1d4', '-1d4'],
  ])('%s normalizes to %s', (input, expected) => {
    expect(formatNotation(terms(input))).toBe(expected);
  });

  it.each([
    [''],
    ['5'],
    ['1d20 2'],
    ['1d'],
    ['0d6'],
    ['101d6'],
    ['1d1'],
    ['1d1001'],
    ['2d20kh3'],
    ['1d20+abc'],
    ['1d2 0'],
  ])('rejects %j', (input) => {
    expect(parseDice(input).ok).toBe(false);
  });
});

describe('splitRollText', () => {
  it('separates the expression from the reason', () => {
    expect(splitRollText('1d20 + 5 longsword attack')).toEqual({
      expression: '1d20 + 5',
      reason: 'longsword attack',
    });
  });

  it('does not glue a reason starting with a number onto the dice', () => {
    expect(splitRollText('1d20 2 goblins')).toEqual({ expression: '1d20', reason: '2 goblins' });
  });

  it('keeps reasons whose words start with dice letters', () => {
    expect(splitRollText('2d6 fire damage')).toEqual({ expression: '2d6', reason: 'fire damage' });
  });

  it('returns null without a valid expression', () => {
    expect(splitRollText('ayuda')).toBeNull();
  });
});

describe('rollTerms', () => {
  it('adds dice and modifiers', () => {
    const result = rollTerms(terms('2d6+1d4-1'), sequence(3, 5, 2));
    expect(result.total).toBe(9);
  });

  it('keeps the highest die with advantage and the lowest with disadvantage', () => {
    expect(rollTerms(terms('2d20kh1+2'), sequence(4, 17)).total).toBe(19);
    expect(rollTerms(terms('2d20kl1'), sequence(4, 17)).total).toBe(4);
  });

  it('keeps the three best of 4d6', () => {
    const result = rollTerms(terms('4d6kh3'), sequence(1, 6, 3, 5));
    expect(result.total).toBe(14);
  });

  it('reports natural 20 and natural 1 on d20 checks only', () => {
    expect(naturalD20(rollTerms(terms('1d20+5'), sequence(20)))).toBe(20);
    expect(naturalD20(rollTerms(terms('2d20kh1'), sequence(1, 20)))).toBe(20);
    expect(naturalD20(rollTerms(terms('2d20kl1'), sequence(1, 20)))).toBe(1);
    expect(naturalD20(rollTerms(terms('2d20'), sequence(20, 20)))).toBeNull();
    expect(naturalD20(rollTerms(terms('1d20+1d4'), sequence(20, 4)))).toBeNull();
  });
});

describe('secureRng', () => {
  it('stays within 1..sides', () => {
    for (let i = 0; i < 2000; i++) {
      const value = secureRng(20);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(20);
    }
  });
});

describe('buildExpression', () => {
  it('builds form selections into notation', () => {
    expect(buildExpression({ count: 3, sides: 8, modifier: 0, mode: 'normal' })).toBe('3d8');
    expect(buildExpression({ count: 1, sides: 20, modifier: 5, mode: 'advantage' })).toBe('2d20kh1+5');
    expect(buildExpression({ count: 1, sides: 20, modifier: -1, mode: 'disadvantage' })).toBe('2d20kl1-1');
  });
});
