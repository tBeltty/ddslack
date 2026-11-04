// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { randomInt } from 'node:crypto';

/** Returns an integer between 1 and `sides`, inclusive. */
export type Rng = (sides: number) => number;

export const secureRng: Rng = (sides) => randomInt(1, sides + 1);

export interface DiceTerm {
  kind: 'dice';
  sign: 1 | -1;
  count: number;
  sides: number;
  keep?: { mode: 'h' | 'l'; n: number };
}

export interface ConstTerm {
  kind: 'const';
  sign: 1 | -1;
  value: number;
}

export type Term = DiceTerm | ConstTerm;

/** The dice the picker offers and the app draws as images. */
export const STANDARD_DICE = [4, 6, 8, 10, 12, 20, 100] as const;

export function isStandardDie(sides: number): boolean {
  return (STANDARD_DICE as readonly number[]).includes(sides);
}

export const LIMITS = {
  maxDice: 100,
  maxSides: 1000,
  maxTerms: 20,
  maxConst: 10000,
  maxLength: 100,
};

export type ParseResult = { ok: true; terms: Term[] } | { ok: false; error: string };

// One term per match: optional sign, then `NdS[kh|klN]` or a plain integer.
// Whitespace is allowed around operators but never inside a term.
const TERM_SOURCE = String.raw`\s*([+-])?\s*(?:(\d*)d(\d+|%)(?:k([hl])(\d+))?|(\d+))`;

function fail(error: string): ParseResult {
  return { ok: false, error };
}

export function parseDice(input: string): ParseResult {
  const text = input.trim();
  if (!text) return fail('Enter a roll, for example `1d20+5`.');
  if (text.length > LIMITS.maxLength) {
    return fail(`The roll is too long (maximum ${LIMITS.maxLength} characters).`);
  }

  const re = new RegExp(TERM_SOURCE, 'iy');
  const terms: Term[] = [];
  let pos = 0;

  while (pos < text.length) {
    re.lastIndex = pos;
    const m = re.exec(text);
    if (!m) return fail(`I don't understand \`${text.slice(pos).trim()}\`.`);

    const [, signRaw, countRaw, sidesRaw, keepMode, keepRaw, constRaw] = m;
    if (terms.length > 0 && !signRaw) {
      return fail(`Missing a \`+\` or \`-\` before \`${m[0].trim()}\`.`);
    }
    const sign = signRaw === '-' ? -1 : 1;

    if (constRaw !== undefined) {
      const value = Number(constRaw);
      if (value > LIMITS.maxConst) return fail(`The maximum modifier is ${LIMITS.maxConst}.`);
      terms.push({ kind: 'const', sign, value });
    } else {
      const count = countRaw ? Number(countRaw) : 1;
      const sides = sidesRaw === '%' ? 100 : Number(sidesRaw);
      if (count < 1 || count > LIMITS.maxDice) {
        return fail(`You can roll between 1 and ${LIMITS.maxDice} dice at a time.`);
      }
      if (sides < 2 || sides > LIMITS.maxSides) {
        return fail(`Dice have between 2 and ${LIMITS.maxSides} sides.`);
      }
      const term: DiceTerm = { kind: 'dice', sign, count, sides };
      if (keepMode) {
        const n = Number(keepRaw);
        if (n < 1 || n > count) return fail(`You can't keep ${n} of ${count} dice.`);
        term.keep = { mode: keepMode.toLowerCase() as 'h' | 'l', n };
      }
      terms.push(term);
    }

    if (terms.length > LIMITS.maxTerms) return fail(`Maximum ${LIMITS.maxTerms} terms per roll.`);
    pos = re.lastIndex;
  }

  if (!terms.some((t) => t.kind === 'dice')) {
    return fail('The roll needs at least one die, for example `1d20`.');
  }
  const dice = terms.reduce((sum, t) => (t.kind === 'dice' ? sum + t.count : sum), 0);
  if (dice > LIMITS.maxDice) return fail(`You can roll at most ${LIMITS.maxDice} dice at a time.`);
  return { ok: true, terms };
}

/**
 * Splits slash command text into the longest leading dice expression and a free-text reason.
 * `1d20 + 5 longsword attack` gives `1d20 + 5` and `longsword attack`.
 */
export function splitRollText(input: string): { expression: string; reason: string } | null {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  // Beginner shorthand: `/roll 20` means one d20 when the number is a standard die.
  const [first] = tokens;
  if (first && /^\d+$/.test(first) && isStandardDie(Number(first))) tokens[0] = `d${first}`;
  for (let n = tokens.length; n > 0; n--) {
    const expression = tokens.slice(0, n).join(' ');
    if (parseDice(expression).ok) return { expression, reason: tokens.slice(n).join(' ') };
  }
  return null;
}

export interface RolledDice {
  term: DiceTerm;
  rolls: number[];
  kept: boolean[];
  subtotal: number;
}

export interface RollResult {
  parts: Array<RolledDice | ConstTerm>;
  total: number;
}

function keepMask(rolls: number[], keep: DiceTerm['keep']): boolean[] {
  if (!keep) return rolls.map(() => true);
  const order = rolls
    .map((value, index) => ({ value, index }))
    .sort((a, b) => (keep.mode === 'h' ? b.value - a.value : a.value - b.value));
  const kept = new Set(order.slice(0, keep.n).map((entry) => entry.index));
  return rolls.map((_, i) => kept.has(i));
}

export function rollTerms(terms: Term[], rng: Rng = secureRng): RollResult {
  let total = 0;
  const parts = terms.map((term): RolledDice | ConstTerm => {
    if (term.kind === 'const') {
      total += term.sign * term.value;
      return term;
    }
    const rolls = Array.from({ length: term.count }, () => rng(term.sides));
    const kept = keepMask(rolls, term.keep);
    const subtotal = rolls.reduce((sum, r, i) => (kept[i] ? sum + r : sum), 0);
    total += term.sign * subtotal;
    return { term, rolls, kept, subtotal };
  });
  return { parts, total };
}

export function formatNotation(terms: Term[]): string {
  return terms
    .map((t, i) => {
      const body =
        t.kind === 'const'
          ? String(t.value)
          : `${t.count}d${t.sides}${t.keep ? `k${t.keep.mode}${t.keep.n}` : ''}`;
      if (i === 0) return t.sign < 0 ? `-${body}` : body;
      return `${t.sign < 0 ? '-' : '+'}${body}`;
    })
    .join('');
}

/** The one die whose face decides the roll (a plain die, or the kept die of advantage or disadvantage). */
export function singleDieFace(result: RollResult): { sides: number; value: number } | null {
  const dice = result.parts.filter((p): p is RolledDice => 'rolls' in p);
  const [only] = dice;
  if (dice.length !== 1 || !only || only.term.sign < 0) return null;
  const keptValues = only.rolls.filter((_, i) => only.kept[i]);
  const [value] = keptValues;
  return keptValues.length === 1 && value !== undefined ? { sides: only.term.sides, value } : null;
}

/** True for a lone die with nothing else, such as `1d20`: shown to beginners without notation. */
export function isPlainSingleDie(terms: Term[]): boolean {
  const [only] = terms;
  return terms.length === 1 && only?.kind === 'dice' && only.count === 1 && !only.keep && only.sign > 0;
}

/** Every die rolled, in order, with whether it counts toward the total. */
export function rolledDice(result: RollResult): Array<{ sides: number; value: number; kept: boolean }> {
  return result.parts.flatMap((part) =>
    'rolls' in part
      ? part.rolls.map((value, i) => ({ sides: part.term.sides, value, kept: part.kept[i] ?? true }))
      : []
  );
}

/** True for one group of dice with nothing else, such as `2d6`: shown without notation. */
export function isPlainDiceGroup(terms: Term[]): boolean {
  const [only] = terms;
  return terms.length === 1 && only?.kind === 'dice' && !only.keep && only.sign > 0;
}

/** The kept d20 value when the roll is a single d20 check (plain, advantage or disadvantage). */
export function naturalD20(result: RollResult): number | null {
  const dice = result.parts.filter((p): p is RolledDice => 'rolls' in p);
  const [only] = dice;
  if (dice.length !== 1 || !only || only.term.sides !== 20) return null;
  const keptValues = only.rolls.filter((_, i) => only.kept[i]);
  const [natural] = keptValues;
  return keptValues.length === 1 && natural !== undefined ? natural : null;
}

export type RollMode = 'normal' | 'advantage' | 'disadvantage';

export function buildExpression(o: {
  count: number;
  sides: number;
  modifier: number;
  mode: RollMode;
}): string {
  const dice = o.mode === 'normal' ? `${o.count}d${o.sides}` : `2d20k${o.mode === 'advantage' ? 'h' : 'l'}1`;
  if (o.modifier === 0) return dice;
  return `${dice}${o.modifier > 0 ? '+' : '-'}${Math.abs(o.modifier)}`;
}
