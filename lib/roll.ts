import type { KnownBlock } from '@slack/types';
import { naturalD20, parseDice, type Rng, type RollResult, rollTerms, secureRng, type Term } from './dice.js';
import {
  compactBlocks,
  diceButtonsBlock,
  diceDetail,
  formatRoll,
  type MessageStyle,
  revealBlocks,
  rollBlocks,
  rollingBlocks,
  rollText,
} from './messages.js';
import type { RollTarget } from './target.js';

export interface RollMessage {
  text: string;
  blocks: KnownBlock[];
}

export interface Roll {
  text: string;
  terms: Term[];
  result: RollResult;
  /** Text plus the die face: what instant and secret rolls post. */
  message: RollMessage;
}

/** Rolls an expression and builds the message every entry point posts: text plus the die image. */
export function performRoll(o: {
  expression: string;
  userId: string;
  reason?: string;
  /** Target number (DC or AC): the text adds Success or Failure. */
  dc?: number;
  /** Critical hit damage; the caller has already doubled the dice. */
  critical?: boolean;
  secret?: boolean;
  /** How the text reads; expert (D&D notation) unless the roller chose beginner. */
  style?: MessageStyle;
  publicBaseUrl?: string;
  rng?: Rng;
}): ({ ok: true } & Roll) | { ok: false; error: string } {
  const parsed = parseDice(o.expression);
  if (!parsed.ok) return parsed;
  const result = rollTerms(parsed.terms, o.rng ?? secureRng);
  const text = formatRoll({
    userId: o.userId,
    terms: parsed.terms,
    result,
    ...(o.reason ? { reason: o.reason } : {}),
    ...(o.dc !== undefined ? { dc: o.dc } : {}),
    ...(o.critical ? { critical: true } : {}),
    ...(o.secret ? { secret: true } : {}),
    ...(o.style ? { style: o.style } : {}),
  });
  return {
    ok: true,
    text,
    terms: parsed.terms,
    result,
    message: { text, blocks: rollBlocks({ text, result, ...(o.publicBaseUrl ? { publicBaseUrl: o.publicBaseUrl } : {}) }) },
  };
}

/** Everything a public roll needs to play out in a conversation. */
export interface RollView {
  /** Shown during the suspense, with the tumbling dice. */
  rolling: RollMessage;
  /** The revealed roll; `target` is where its dice buttons roll next. */
  reveal(target: RollTarget): RollMessage;
  /** Posted at once when there is no suspense (the bot is not in the channel). */
  instant: RollMessage;
  /** One line, once a newer roll arrives. */
  compact: RollMessage;
  /** Kept d20 of a single d20 check, to celebrate a natural 20 or 1. */
  natural: number | null;
}

export function standardView(roll: Roll, userId: string, publicBaseUrl?: string, label?: string): RollView {
  const base = publicBaseUrl ? { publicBaseUrl } : {};
  return {
    rolling: rollingBlocks({ userId, terms: roll.terms, ...base, ...(label ? { label } : {}) }),
    reveal: (target) => ({ text: roll.text, blocks: revealBlocks({ text: roll.text, result: roll.result, target, ...base }) }),
    instant: roll.message,
    compact: { text: roll.text, blocks: compactBlocks(roll.text) },
    natural: naturalD20(roll.result),
  };
}

/** A death saving throw: one d20, read by the rule (10 or more succeeds; 1 and 20 are special). */
export function deathSaveView(o: { userId: string; publicBaseUrl?: string; rng?: Rng }): RollView {
  const roll = performRoll({ expression: '1d20', userId: o.userId, ...pick(o) });
  if (!roll.ok) throw new Error(roll.error);
  const value = roll.result.total;
  const outcome =
    value === 20 ? 'You regain 1 hit point' : value === 1 ? 'Two failures' : value >= 10 ? 'Success' : 'Failure';
  const text = `<@${o.userId}> rolled a death saving throw: *${value}*. ${outcome}.`;
  const withText: Roll = {
    ...roll,
    text,
    message: {
      text,
      blocks: rollBlocks({ text, result: roll.result, ...(o.publicBaseUrl ? { publicBaseUrl: o.publicBaseUrl } : {}) }),
    },
  };
  return standardView(withText, o.userId, o.publicBaseUrl, 'a death saving throw');
}

/** New character ability scores: 4d6 keeping the highest three, six times. */
export function abilityScoresView(o: { userId: string; publicBaseUrl?: string; rng?: Rng }): RollView {
  const parsed = parseDice('4d6kh3');
  if (!parsed.ok) throw new Error(parsed.error);
  const sets = Array.from({ length: 6 }, () => rollTerms(parsed.terms, o.rng ?? secureRng));
  const scores = sets.map((set) => set.total);
  const text = `<@${o.userId}> rolled ability scores: ${scores.map((s) => `*${s}*`).join(', ')} (total ${scores.reduce((a, b) => a + b, 0)})`;
  const detail = sets
    .map((set) => `${diceDetail(set)} = ${set.total}`)
    .join('  ·  ');
  const body: KnownBlock[] = [
    { type: 'section', text: rollText(text) },
    { type: 'context', elements: [rollText(`4d6, highest three: ${detail}`)] },
  ];
  return {
    rolling: rollingBlocks({
      userId: o.userId,
      terms: parsed.terms,
      label: 'ability scores',
      ...(o.publicBaseUrl ? { publicBaseUrl: o.publicBaseUrl } : {}),
    }),
    reveal: (target) => ({ text, blocks: [...body, diceButtonsBlock(target)] }),
    instant: { text, blocks: body },
    compact: { text, blocks: compactBlocks(text) },
    natural: null,
  };
}

function pick(o: { publicBaseUrl?: string; rng?: Rng }): { publicBaseUrl?: string; rng?: Rng } {
  return { ...(o.publicBaseUrl ? { publicBaseUrl: o.publicBaseUrl } : {}), ...(o.rng ? { rng: o.rng } : {}) };
}
