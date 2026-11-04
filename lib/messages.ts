import type { KnownBlock, View } from '@slack/types';
import {
  critImageName,
  diceImageUrl,
  imageUrl,
  MAX_VISIBLE_DICE,
  rollingImageName,
  stripImageName,
} from './assets.js';
import {
  buildExpression,
  type DiceTerm,
  formatNotation,
  isPlainDiceGroup,
  isPlainSingleDie,
  isStandardDie,
  naturalD20,
  type RolledDice,
  type RollMode,
  type RollResult,
  rolledDice,
  STANDARD_DICE,
  singleDieFace,
  type Term,
} from './dice.js';
import { encodeTarget, type RollTarget } from './target.js';

export const OPEN_ROLL_MODAL = 'open_roll_modal';
export const ROLL_MODAL = 'roll_modal';
export const ROLL_HERE_SHORTCUT = 'roll_here';
export const ROLL_ACTION = 'roll';
export const DIE_ACTION = 'die';
export const DICE_COUNT_ACTION = 'dice_count';
export const MODIFIER_ACTION = 'modifier';
export const ROLL_TYPE_ACTION = 'roll_type';
export const SPECIAL_ROLL_ACTION = 'special_roll';
/** Pickers posted before the die menu had one button per die and a d20 mode menu. */
export const ROLL_DIE_ACTION = /^roll_d(\d+)$/;
export const D20_MODE_ACTION = 'd20_mode';
export type SpecialRoll = 'stats' | 'death';
const DICE_BLOCK = 'dice';
export const MAX_PICKER_DICE = 10;
export const PICKER_MODIFIERS = { min: -5, max: 20 } as const;

/** Normal, advantage or disadvantage for a d20; critical hit for damage dice. */
export type RollType = RollMode | 'critical';

/** What a picker or the form is set to roll. */
export interface DiceChoice {
  sides: number;
  count: number;
  modifier: number;
  type: RollType;
}

export const DEFAULT_CHOICE: DiceChoice = { sides: 20, count: 1, modifier: 0, type: 'normal' };

export function rollDieActionId(sides: number): string {
  return `roll_d${sides}`;
}

/** The die size behind a one-click button, or null for anything that is not a standard die. */
export function parseRollDieActionId(actionId: string): number | null {
  const sides = Number(ROLL_DIE_ACTION.exec(actionId)?.[1]);
  return isStandardDie(sides) ? sides : null;
}

export const HELP_TEXT = [
  '*How to roll dice*',
  '• `/roll`: pick your dice from the menus',
  '• `/roll d20` or `/roll 20`: roll one die',
  '• `/roll 1d20+5 attack`: add a bonus and a reason',
  '• `/roll 2d20kh1`: advantage (`2d20kl1` for disadvantage)',
  '• `/roll stats`: ability scores for a new character (4d6, highest three, six times)',
  '• `/roll death`: a death saving throw',
  '• Mention the bot in a thread or in a Huddle chat to roll right there',
].join('\n');

/**
 * Neutralizes user text before it goes into mrkdwn, so a reason cannot ping `<!channel>` or a
 * plain `@here`: a zero-width space after the `@` keeps the word readable and inert.
 */
export function escapeMrkdwn(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@(here|channel|everyone)\b/gi, '@\u200B$1');
}

/** Longest reason shown with a roll, the same as the form allows. */
export const MAX_REASON = 80;

function reasonLabel(reason: string | undefined): string {
  const trimmed = reason?.trim() ?? '';
  return escapeMrkdwn(trimmed.length > MAX_REASON ? `${trimmed.slice(0, MAX_REASON - 1)}…` : trimmed);
}

/** Slack refuses a section or context text over 3,000 characters, which would leave a roll stuck. */
const MAX_BLOCK_TEXT = 3000;

/** Roll text as a block: literal (no automatic mentions or links) and cut to fit Slack's limit. */
export function rollText(text: string): { type: 'mrkdwn'; text: string; verbatim: true } {
  const fitted = text.length > MAX_BLOCK_TEXT ? `${text.slice(0, MAX_BLOCK_TEXT - 1)}…` : text;
  return { type: 'mrkdwn', text: fitted, verbatim: true };
}

function formatDice(part: RolledDice): string {
  const values = part.rolls.map((r, i) => (part.kept[i] ? String(r) : `~${r}~`));
  return `[${values.join(', ')}]`;
}

/** Every die and modifier of a roll, dropped dice struck through: `[6, 5, 4, ~1~] + 2`. */
export function diceDetail(result: RollResult): string {
  return result.parts
    .map((part, i) => {
      const body = 'rolls' in part ? formatDice(part) : String(part.value);
      const sign = 'rolls' in part ? part.term.sign : part.sign;
      if (i === 0) return sign < 0 ? `-${body}` : body;
      return `${sign < 0 ? '-' : '+'} ${body}`;
    })
    .join(' ');
}

/** How a person's rolls read: plain sentences for beginners, D&D notation for experts. */
export type MessageStyle = 'beginner' | 'expert';
export const DEFAULT_STYLE: MessageStyle = 'beginner';

export interface FormatOptions {
  userId: string;
  terms: Term[];
  result: RollResult;
  reason?: string;
  /** Target number (DC or AC): adds Success or Failure. */
  dc?: number;
  critical?: boolean;
  secret?: boolean;
  style?: MessageStyle;
}

export function formatRoll(o: FormatOptions): string {
  const line = o.style === 'beginner' ? beginnerLine(o) : expertLine(o);
  return o.secret ? `Only you can see this roll.\n${line}` : line;
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const inWords = (n: number) => NUMBER_WORDS[n] ?? String(n);
const listed = (values: number[]) =>
  values.length <= 1 ? values.join('') : `${values.slice(0, -1).join(', ')} and ${values.at(-1)}`;

/**
 * Plain sentences for one group of dice plus bonuses, the shape every picker and form roll has:
 * "rolled two d20 with disadvantage: 8 and 11. Disadvantage keeps the lower one: *8*".
 * Anything more complex falls back to the expert line.
 */
function beginnerLine(o: FormatOptions): string {
  const dice = o.terms.filter((t): t is DiceTerm => t.kind === 'dice');
  const [term] = dice;
  const rolled = o.result.parts.find((p): p is RolledDice => 'rolls' in p);
  if (dice.length !== 1 || !term || term.sign < 0 || !rolled) return expertLine(o);

  const bonus = o.terms.reduce((sum, t) => (t.kind === 'const' ? sum + t.sign * t.value : sum), 0);
  const labels = [o.critical ? 'critical hit, dice doubled' : '', reasonLabel(o.reason)];
  const shown = labels.filter(Boolean);
  const reason = shown.length > 0 ? ` (${shown.join(', ')})` : '';
  const what = term.count === 1 ? `a d${term.sides}` : `${inWords(term.count)} d${term.sides}`;
  const advantage = term.count === 2 && term.sides === 20 && term.keep?.n === 1;
  const mode = advantage ? (term.keep?.mode === 'h' ? 'advantage' : 'disadvantage') : '';

  const sentences: string[] = [];
  const kept = rolled.subtotal;
  const total = (value: number) => (bonus === 0 ? `*${value}*` : `${value}`);
  if (mode) {
    sentences.push(`<@${o.userId}> rolled ${what} with ${mode}${reason}: ${listed(rolled.rolls)}`);
    sentences.push(`${mode === 'advantage' ? 'Advantage keeps the higher' : 'Disadvantage keeps the lower'} one: ${total(kept)}`);
  } else if (term.keep) {
    const droppedCount = term.count - term.keep.n;
    sentences.push(`<@${o.userId}> rolled ${what}${reason}: ${listed(rolled.rolls)}`);
    sentences.push(
      `It keeps the ${term.keep.mode === 'h' ? 'highest' : 'lowest'} ${inWords(term.keep.n)} and drops ${inWords(droppedCount)}: ${total(kept)}`
    );
  } else if (term.count === 1) {
    sentences.push(`<@${o.userId}> rolled ${what}${reason}${bonus === 0 ? ':' : ' and got'} ${total(kept)}`);
  } else {
    sentences.push(`<@${o.userId}> rolled ${what}${reason}: ${rolled.rolls.join(' + ')} = ${total(kept)}`);
  }
  if (bonus !== 0) sentences.push(`With ${bonus > 0 ? '+' : '-'}${Math.abs(bonus)}, the total is *${o.result.total}*`);
  if (o.dc !== undefined) {
    sentences.push(`Needed ${o.dc} or more: *${o.result.total >= o.dc ? 'Success' : 'Failure'}*`);
  }
  const natural = naturalD20(o.result);
  if (natural === 20) sentences.push('*Natural 20!* The best possible roll');
  if (natural === 1) sentences.push('*Natural 1.* The worst possible roll');
  return sentences.join('. ');
}

/** D&D notation with every die: "rolled `2d20kl1`: [8, ~11~] = *8*". */
function expertLine(o: FormatOptions): string {
  const detail = diceDetail(o.result);
  const labels = [o.critical ? 'critical hit' : '', reasonLabel(o.reason)];
  const shown = labels.filter(Boolean);
  const reason = shown.length > 0 ? ` (${shown.join(', ')})` : '';
  const verdict = o.dc === undefined ? '' : ` vs ${o.dc}: *${o.result.total >= o.dc ? 'Success' : 'Failure'}*`;
  const natural = naturalD20(o.result);
  const note = natural === 20 ? '  *Natural 20!*' : natural === 1 ? '  *Natural 1*' : '';
  const values = rolledDice(o.result).map((d) => d.value);
  const line = isPlainSingleDie(o.terms)
    ? `<@${o.userId}> rolled a ${formatNotation(o.terms).slice(1)}${reason}: *${o.result.total}*${verdict}${note}`
    : isPlainDiceGroup(o.terms)
      ? `<@${o.userId}> rolled ${formatNotation(o.terms)}${reason}: ${values.join(' + ')} = *${o.result.total}*${verdict}`
      : `<@${o.userId}> rolled \`${formatNotation(o.terms)}\`${reason}: ${detail} = *${o.result.total}*${verdict}${note}`;
  return line;
}

/**
 * The roll text with its dice: one die as a thumbnail next to the text, several dice as a
 * strip below it (at most three faces, then a "+N" badge; dropped dice faded).
 * Dice that are not standard have no images, so such rolls are text only.
 */
export function rollBlocks(o: { text: string; result: RollResult; publicBaseUrl?: string }): KnownBlock[] {
  const section: KnownBlock = { type: 'section', text: rollText(o.text) };
  const dice = rolledDice(o.result);
  if (!o.publicBaseUrl || dice.length === 0 || !dice.every((d) => isStandardDie(d.sides))) return [section];

  const face = singleDieFace(o.result);
  if (dice.length === 1 && face) {
    return [
      {
        ...section,
        accessory: {
          type: 'image',
          image_url: diceImageUrl(o.publicBaseUrl, face.sides, face.value),
          alt_text: `d${face.sides} showing ${face.value}`,
        },
      },
    ];
  }
  const shown = dice.slice(0, MAX_VISIBLE_DICE).map((d) => `d${d.sides} ${d.value}${d.kept ? '' : ' (dropped)'}`);
  const more = dice.length > MAX_VISIBLE_DICE ? ` and ${dice.length - MAX_VISIBLE_DICE} more` : '';
  return [
    section,
    {
      type: 'image',
      image_url: imageUrl(o.publicBaseUrl, stripImageName(dice.map((d) => ({ ...d, dropped: !d.kept })))),
      alt_text: `${shown.join(', ')}${more}`,
    },
  ];
}

const ROLL_TYPES: Array<{ value: RollType; label: string }> = [
  // Short labels: Slack truncates select text around 14 characters.
  { value: 'normal', label: 'Normal' },
  { value: 'advantage', label: 'Advantage' },
  { value: 'disadvantage', label: 'Disadvantage' },
  { value: 'critical', label: 'Critical hit' },
];

const plainOption = (o: { value: string; label: string }) => ({
  text: { type: 'plain_text' as const, text: o.label },
  value: o.value,
});

const typeOption = (type: RollType) => plainOption(ROLL_TYPES.find((t) => t.value === type) ?? { value: 'normal', label: 'Normal' });

const countOption = (count: number) => ({
  text: { type: 'plain_text' as const, text: count === 1 ? '1 die' : `${count} dice` },
  value: String(count),
});

const modifierOption = (modifier: number) => ({
  text: {
    type: 'plain_text' as const,
    text: modifier === 0 ? 'No modifier' : `${modifier > 0 ? '+' : '-'}${Math.abs(modifier)} modifier`,
  },
  value: String(modifier),
});

const MODIFIER_OPTIONS = Array.from({ length: PICKER_MODIFIERS.max - PICKER_MODIFIERS.min + 1 }, (_, i) =>
  modifierOption(PICKER_MODIFIERS.min + i)
);

/**
 * The die, how many, the modifier and the roll type, then one Roll button, More options and a
 * menu with the special rolls. Every roll message reuses it. Slack sends the selections along
 * with the click, so nothing is stored, and each person's selections stay on their own screen.
 */
export function diceButtonsBlock(target: RollTarget): KnownBlock {
  const value = encodeTarget(target);
  return {
    type: 'actions',
    block_id: DICE_BLOCK,
    elements: [
      {
        type: 'static_select',
        action_id: DIE_ACTION,
        placeholder: { type: 'plain_text', text: 'Die' },
        options: DIE_OPTIONS,
        initial_option: dieOption(DEFAULT_CHOICE.sides),
      },
      {
        type: 'static_select',
        action_id: DICE_COUNT_ACTION,
        placeholder: { type: 'plain_text', text: 'How many' },
        options: Array.from({ length: MAX_PICKER_DICE }, (_, i) => countOption(i + 1)),
        initial_option: countOption(DEFAULT_CHOICE.count),
      },
      {
        type: 'static_select',
        action_id: MODIFIER_ACTION,
        placeholder: { type: 'plain_text', text: 'Modifier' },
        options: MODIFIER_OPTIONS,
        initial_option: modifierOption(DEFAULT_CHOICE.modifier),
      },
      {
        type: 'static_select',
        action_id: ROLL_TYPE_ACTION,
        placeholder: { type: 'plain_text', text: 'Type' },
        options: ROLL_TYPES.map(plainOption),
        initial_option: typeOption(DEFAULT_CHOICE.type),
      },
      { type: 'button', action_id: ROLL_ACTION, text: { type: 'plain_text', text: 'Roll' }, style: 'primary', value },
      { type: 'button', action_id: OPEN_ROLL_MODAL, text: { type: 'plain_text', text: 'More options' }, value },
      {
        type: 'overflow',
        action_id: SPECIAL_ROLL_ACTION,
        options: [
          { text: { type: 'plain_text', text: 'Ability scores' }, value: `stats|${value}` },
          { text: { type: 'plain_text', text: 'Death saving throw' }, value: `death|${value}` },
        ],
      },
    ],
  };
}

/** The picker posted after a mention or `/roll`: a title and the menus. The Home tab explains the rest. */
export function launcherBlocks(target: RollTarget): KnownBlock[] {
  return [{ type: 'section', text: { type: 'mrkdwn', text: '*Pick your dice*' } }, diceButtonsBlock(target)];
}

/** "@Ana is rolling a d20…" with the tumbling die, shown during the suspense before the reveal. */
export function rollingBlocks(o: { userId: string; terms: Term[]; publicBaseUrl?: string; label?: string }): {
  text: string;
  blocks: KnownBlock[];
} {
  const notation = formatNotation(o.terms);
  const label = o.label
    ? o.label
    : isPlainSingleDie(o.terms)
      ? `a ${notation.slice(1)}`
    : isPlainDiceGroup(o.terms)
      ? notation
      : `\`${notation}\``;
  const text = `<@${o.userId}> is rolling ${label}…`;
  const section: KnownBlock = { type: 'section', text: rollText(text) };
  const dice = o.terms.filter((t) => t.kind === 'dice');
  const [firstDie] = dice;
  const count = dice.reduce((sum, t) => sum + t.count, 0);
  if (!o.publicBaseUrl || !firstDie || !isStandardDie(firstDie.sides)) return { text, blocks: [section] };

  const gif = imageUrl(o.publicBaseUrl, rollingImageName(firstDie.sides, count));
  const alt = `${Math.min(count, MAX_VISIBLE_DICE) === 1 ? `d${firstDie.sides}` : 'dice'} rolling`;
  // One die sits next to the text; several dice need the width of an image block.
  return count === 1
    ? { text, blocks: [{ ...section, accessory: { type: 'image', image_url: gif, alt_text: alt } }] }
    : { text, blocks: [section, { type: 'image', image_url: gif, alt_text: alt }] };
}

/**
 * The revealed roll: the face next to the text and the dice buttons below, so the newest
 * roll is always the place to roll again. A natural 20 or natural 1 shows its large image.
 */
export function revealBlocks(o: {
  text: string;
  result: RollResult;
  target: RollTarget;
  publicBaseUrl?: string;
}): KnownBlock[] {
  const natural = naturalD20(o.result);
  const singleDie = rolledDice(o.result).length === 1;
  if (o.publicBaseUrl && singleDie && (natural === 20 || natural === 1)) {
    return [
      { type: 'section', text: rollText(o.text) },
      {
        type: 'image',
        image_url: imageUrl(o.publicBaseUrl, critImageName(natural)),
        alt_text: natural === 20 ? 'Natural 20' : 'Natural 1',
      },
      diceButtonsBlock(o.target),
    ];
  }
  return [
    ...rollBlocks({ text: o.text, result: o.result, ...(o.publicBaseUrl ? { publicBaseUrl: o.publicBaseUrl } : {}) }),
    diceButtonsBlock(o.target),
  ];
}

/** An older roll once a newer one arrives: one small line, no image and no buttons. */
export function compactBlocks(text: string): KnownBlock[] {
  return [{ type: 'context', elements: [rollText(text)] }];
}

export const LAUNCHER_FALLBACK = 'Pick your dice.';

/** A special roll chosen from the picker's menu, with the destination the menu carries. */
export function parseSpecialRoll(value: string | undefined): { kind: SpecialRoll; target: string } | null {
  const [kind, ...rest] = (value ?? '').split('|');
  return kind === 'stats' || kind === 'death' ? { kind, target: rest.join('|') } : null;
}

type PickerState = { values?: FormValues } | undefined;

function selected(state: PickerState, actionId: string): string | undefined {
  return state?.values?.[DICE_BLOCK]?.[actionId]?.selected_option?.value;
}

function integerIn(raw: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number(raw ?? fallback);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

function asRollType(raw: string | undefined): RollType {
  return ROLL_TYPES.some((t) => t.value === raw) ? (raw as RollType) : 'normal';
}

/** What a picker was set to when its Roll button was clicked; anything unexpected falls back to the default. */
export function readPicker(state: PickerState): DiceChoice {
  const sides = Number(selected(state, DIE_ACTION));
  return {
    sides: isStandardDie(sides) ? sides : DEFAULT_CHOICE.sides,
    count: readDiceCount(state),
    modifier: integerIn(selected(state, MODIFIER_ACTION), PICKER_MODIFIERS.min, PICKER_MODIFIERS.max, 0),
    type: asRollType(selected(state, ROLL_TYPE_ACTION)),
  };
}

/** The count chosen in a dice picker; 1 if unset. */
export function readDiceCount(state: PickerState): number {
  return integerIn(selected(state, DICE_COUNT_ACTION), 1, MAX_PICKER_DICE, 1);
}

/** Why a roll type does not fit the dice, in words for the person who chose it; null if it fits. */
export function rollTypeProblem(choice: DiceChoice): string | null {
  if (choice.type === 'advantage' || choice.type === 'disadvantage') {
    if (choice.sides !== 20) return 'Advantage and disadvantage apply to the d20. Choose the d20, or the Normal type.';
    if (choice.count !== 1) return 'Advantage and disadvantage roll two d20 and keep one, so choose 1 die.';
  }
  if (choice.type === 'critical' && choice.sides === 20) {
    return 'A critical hit doubles the damage dice. Choose the damage die, such as d6 or d8.';
  }
  return null;
}

/** The expression a choice rolls: a critical hit rolls the dice twice and adds the modifier once. */
export function choiceExpression(choice: DiceChoice): string {
  const critical = choice.type === 'critical';
  return buildExpression({
    count: critical ? choice.count * 2 : choice.count,
    sides: choice.sides,
    modifier: choice.modifier,
    mode: choice.type === 'critical' ? 'normal' : choice.type,
  });
}

/** What an older picker's die button rolls: the count of that die, or 2d20 for its d20 mode. */
export function legacyPickerExpression(sides: number, state: PickerState): string {
  const mode = sides === 20 ? selected(state, D20_MODE_ACTION) : undefined;
  if (mode === 'advantage' || mode === 'disadvantage') return `2d20k${mode === 'advantage' ? 'h' : 'l'}1`;
  return `${readDiceCount(state)}d${sides}`;
}

const dieOption = (sides: number) => ({
  text: { type: 'plain_text' as const, text: `d${sides}` },
  value: String(sides),
});

const DIE_OPTIONS = STANDARD_DICE.map(dieOption);

/** The form behind More options, starting from what the picker was set to. */
export function rollModal(target: RollTarget, choice: DiceChoice = DEFAULT_CHOICE): View {
  const destination = target.threadTs ? 'The result will be posted in the thread.' : 'The result will be posted in the channel.';

  return {
    type: 'modal',
    callback_id: ROLL_MODAL,
    private_metadata: encodeTarget(target),
    title: { type: 'plain_text', text: 'Roll dice' },
    submit: { type: 'plain_text', text: 'Roll' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      { type: 'context', elements: [{ type: 'mrkdwn', text: destination }] },
      {
        type: 'input',
        block_id: 'die',
        label: { type: 'plain_text', text: 'Dice' },
        element: {
          type: 'static_select',
          action_id: 'value',
          options: DIE_OPTIONS,
          initial_option: dieOption(choice.sides),
        },
      },
      {
        type: 'input',
        block_id: 'count',
        label: { type: 'plain_text', text: 'Count' },
        element: {
          type: 'number_input',
          action_id: 'value',
          is_decimal_allowed: false,
          min_value: '1',
          max_value: '100',
          initial_value: String(choice.count),
        },
      },
      {
        type: 'input',
        block_id: 'modifier',
        label: { type: 'plain_text', text: 'Modifier' },
        element: {
          type: 'number_input',
          action_id: 'value',
          is_decimal_allowed: false,
          min_value: '-100',
          max_value: '100',
          initial_value: String(choice.modifier),
        },
      },
      {
        type: 'input',
        block_id: 'type',
        label: { type: 'plain_text', text: 'Roll type' },
        hint: {
          type: 'plain_text',
          text: 'Advantage and disadvantage roll two d20 and keep one. A critical hit doubles the damage dice, not the modifier.',
        },
        element: {
          type: 'radio_buttons',
          action_id: 'value',
          options: ROLL_TYPES.map(plainOption),
          initial_option: typeOption(choice.type),
        },
      },
      {
        type: 'input',
        block_id: 'dc',
        optional: true,
        label: { type: 'plain_text', text: 'Target number' },
        hint: { type: 'plain_text', text: 'The DC or AC to beat. The result says Success or Failure.' },
        element: {
          type: 'number_input',
          action_id: 'value',
          is_decimal_allowed: false,
          min_value: '1',
          max_value: '100',
        },
      },
      {
        type: 'input',
        block_id: 'reason',
        optional: true,
        label: { type: 'plain_text', text: 'Reason' },
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          max_length: 80,
          placeholder: { type: 'plain_text', text: 'e.g. Longsword attack' },
        },
      },
      {
        type: 'input',
        block_id: 'secret',
        optional: true,
        label: { type: 'plain_text', text: 'Privacy' },
        element: {
          type: 'checkboxes',
          action_id: 'value',
          options: [{ text: { type: 'plain_text', text: 'Only I can see the result' }, value: 'secret' }],
        },
      },
    ],
  };
}

interface FieldState {
  value?: string | null;
  selected_option?: { value: string } | null;
  selected_options?: Array<{ value: string }>;
}

export type FormValues = Record<string, Record<string, FieldState>>;

export type RollForm =
  | { ok: true; expression: string; reason: string; secret: boolean; dc?: number; critical: boolean }
  | { ok: false; errors: Record<string, string> };

export function readRollForm(values: FormValues): RollForm {
  const field = (block: string) => values[block]?.value;
  const choice: DiceChoice = {
    sides: Number(field('die')?.selected_option?.value ?? 20),
    count: Number(field('count')?.value ?? 1),
    modifier: Number(field('modifier')?.value ?? 0),
    type: asRollType(field('type')?.selected_option?.value),
  };
  const reason = field('reason')?.value ?? '';
  const secret = (field('secret')?.selected_options ?? []).some((o) => o.value === 'secret');
  const dcRaw = field('dc')?.value;
  const dc = dcRaw === undefined || dcRaw === null || dcRaw === '' ? undefined : Number(dcRaw);

  const errors: Record<string, string> = {};
  if (!isStandardDie(choice.sides)) errors.die = 'Choose one of the dice.';
  if (!Number.isInteger(choice.count) || choice.count < 1 || choice.count > 100) errors.count = 'Choose between 1 and 100 dice.';
  if (!Number.isInteger(choice.modifier) || Math.abs(choice.modifier) > 100) {
    errors.modifier = 'Use a number between -100 and 100.';
  }
  const problem = rollTypeProblem(choice);
  if (problem) errors.type = problem;
  else if (choice.type === 'critical' && choice.count > 50) errors.type = 'A critical hit doubles the dice; choose 50 or fewer.';
  if (dc !== undefined && (!Number.isInteger(dc) || dc < 1 || dc > 100)) errors.dc = 'Use a number between 1 and 100.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    expression: choiceExpression(choice),
    reason,
    secret,
    critical: choice.type === 'critical',
    ...(dc !== undefined ? { dc } : {}),
  };
}
