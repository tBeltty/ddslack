# Using Dice Companion

## Ways to roll

| Action | Where the result appears |
|---|---|
| Mention the bot in a thread or in a Huddle chat | The bot replies in that thread with a picker: die, how many (1 to 10), modifier (-5 to +20), type (normal, advantage, disadvantage, critical hit) and a **Roll** button that rolls them there |
| `/roll` with no text | Shows the picker only to you; each roll is posted in the channel |
| `/roll d20` or `/roll 20` | Rolls one die in the channel |
| `/roll 1d20+5 attack` | Rolls with a bonus and a reason in the channel |
| **More options** button | Opens the form with the picker's choices filled in, plus a target number (DC or AC: the result says Success or Failure), a reason and a secret roll; it also allows up to 100 dice and a modifier up to ±100 |
| **⋯** menu, or `/roll stats` | Ability scores for a new character: 4d6 keeping the highest three, six times |
| **⋯** menu, or `/roll death` | A death saving throw: 10 or more succeeds, a 1 counts as two failures, a 20 regains 1 hit point |
| Message menu > **Roll dice here** | Opens the form; the result appears in that message's thread |

The picker starts on one d20 with no modifier, since attacks, ability checks and saving throws all use it. Advantage and disadvantage roll two d20 and keep one; a critical hit rolls the damage dice twice and adds the modifier once (SRD). A type that does not fit the die (advantage on a d6, a critical hit on the d20) gets a note that only the person who clicked sees, and nothing is rolled. Each person's menu choices stay on their own screen until they press Roll. Pickers posted before this layout keep their per-die buttons working.

Notation: `1d20+5`, `2d6+1d4-1`, `2d20kh1` (advantage), `2d20kl1` (disadvantage), `4d6kh3`, `1d%`.

When a roll comes down to one standard die, the message shows a picture of that die's face. A natural 20 is gold and a natural 1 is red. Several dice show in a row, at most three, with a "+N" badge for the rest and every value plus the total in the text; with advantage or disadvantage the dropped die is faded.

## How a roll plays out

1. The bot posts "@player is rolling a d20…" with the die tumbling (two or three dice tumble side by side for bigger rolls).
2. After about a second it edits that same message to reveal the result: the face image and the picker to roll again. The result is decided at the click; the animation only presents it.
3. A natural 20 or natural 1 shows a large image, and the bot reacts with 🎉 or 💀.
4. The previous roll in the same thread, Huddle chat or channel shrinks to one small line with its result, without image or buttons. The dice picker from the mention is removed. Only the newest roll keeps the image and the picker, so the conversation stays short and the place to roll again is always at the bottom.

Rolls stay in the history; nothing with a result is deleted. Secret rolls and rolls in channels the bot has not joined are posted at once, without suspense or tidying. The bot remembers the newest roll per conversation in memory, so after a restart the roll revealed just before it stays in full.

## App Home

Opening the app in Slack shows a Home tab with a **Message style** setting and a guide. The setting is per person and changes how their own rolls read: *Beginner* (the default) explains each roll in plain sentences, such as "rolled two d20 with disadvantage: 8 and 11. Disadvantage keeps the lower one: 8", and spells out target numbers as "Needed 15 or more: Success"; *Expert* uses D&D notation, such as "rolled `2d20kl1`: [8, ~11~] = 8". The guide covers how to roll, which die to use (with SRD damage examples), roll notation, what the gold, red and faded dice mean, and how to invite the bot. The tab is published with `views.publish` when the `app_home_opened` event arrives. The Messages tab is off. The About tab shows the long description from `manifest.json`.

## When the bot responds

Only when explicitly invoked: by mentioning it, with `/roll`, with its button, or with its shortcut. Besides its mentions, it receives only `app_home_opened` (someone opened its Home tab) and `app_uninstalled` and `tokens_revoked` (a workspace removed it). None of them carry messages. Mentioning another person, pasting a link, or typing "d20" in a conversation produces no response. The app does not subscribe to channel messages and does not request history-read permissions (`tests/manifest.test.ts` checks this).

The bot must be a member of the channel (`/invite @Nat20`) to receive mentions. Slack does not deliver mentions in direct messages.
