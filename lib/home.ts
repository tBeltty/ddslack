// SPDX-FileCopyrightText: 2016 Wizards of the Coast LLC
// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later AND CC-BY-4.0

import type { HomeView, KnownBlock } from '@slack/types';
import type { MessageStyle } from './messages.js';

export const MESSAGE_STYLE_ACTION = 'message_style';

const section = (text: string): KnownBlock => ({ type: 'section', text: { type: 'mrkdwn', text } });
const heading = (text: string): KnownBlock => ({ type: 'header', text: { type: 'plain_text', text } });

const STYLES: Array<{ value: MessageStyle; label: string; example: string }> = [
  { value: 'beginner', label: 'Beginner', example: 'rolled two d20 with advantage: 8 and 11. Advantage keeps the higher one: 11' },
  { value: 'expert', label: 'Expert', example: 'rolled 2d20kh1: [~8~, 11] = 11' },
];

const styleOption = (s: (typeof STYLES)[number]) => ({
  text: { type: 'plain_text' as const, text: s.label },
  description: { type: 'plain_text' as const, text: s.example },
  value: s.value,
});

/**
 * The App Home tab: a guide to rolling, the same for everyone apart from the greeting.
 * Damage examples come from the SRD 5.1 (dagger, shortsword, longsword, greataxe, greatsword,
 * fireball cast at 3rd level).
 */
export function homeView(userId: string, style: MessageStyle): HomeView {
  const current = STYLES.find((s) => s.value === style) ?? (STYLES[0] as (typeof STYLES)[number]);
  return {
    type: 'home',
    blocks: [
      heading('Dice Companion'),
      section(`Hi <@${userId}>. Nat20 rolls dice for your D&D games in Slack, in channels, threads and Huddle chats.`),
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Message style*\nHow your own rolls read in the channel. Everyone else chooses their own.',
        },
        accessory: {
          type: 'radio_buttons',
          action_id: MESSAGE_STYLE_ACTION,
          options: STYLES.map(styleOption),
          initial_option: styleOption(current),
        },
      },
      { type: 'divider' },

      heading('How to roll'),
      section(
        [
          '• Mention *@Nat20* in a thread or a Huddle chat. The dice picker appears right there.',
          '• Type `/roll 1d20+5 attack` to roll in a channel. `/roll` on its own shows the picker only to you.',
          '• In the picker, choose the die, how many, your modifier and the type, then press *Roll*.',
          '• *Advantage* and *Disadvantage* roll two d20 and keep one. *Critical hit* rolls the damage dice twice and adds the modifier once.',
          '• *More options* adds a target number (DC or AC), a reason or a secret roll.',
          '• The *⋯* menu, `/roll stats` and `/roll death` roll ability scores (4d6, keep the highest three, six times) and death saving throws.',
        ].join('\n')
      ),

      heading('Which die do I roll?'),
      section(
        [
          '• *d20*: attacks, ability checks and saving throws.',
          '• *Damage* depends on the weapon or spell: dagger 1d4, shortsword 1d6, longsword 1d8, greataxe 1d12, greatsword 2d6, fireball 8d6.',
          '• *d100*: percentile tables.',
        ].join('\n')
      ),

      heading('Roll notation'),
      section(
        [
          '`2d6+3`  two six-sided dice plus 3',
          '`2d20kh1`  advantage: roll two d20, keep the higher',
          '`2d20kl1`  disadvantage: keep the lower',
          '`4d6kh3`  one ability score: four d6, keep the highest three',
          '`d%`  a percentile roll, 1 to 100',
        ].join('\n')
      ),

      heading('Reading the dice'),
      section(
        [
          '• A *gold* d20 is a natural 20. A *red* d20 is a natural 1.',
          '• A *faded* die was dropped by advantage or disadvantage.',
          '• Only the newest roll in a thread keeps its picture and picker. Older rolls shrink to one line.',
        ].join('\n')
      ),

      heading('Getting started'),
      section(
        'Invite Nat20 to a channel with `/invite @Nat20`. It answers only when you mention it, type `/roll` or press its buttons, and it never reads other messages.'
      ),
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: 'Each roll is decided by a cryptographically secure random generator the moment you press the button. The animation only shows the result.',
          },
        ],
      },
    ],
  };
}
