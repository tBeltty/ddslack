# Dice Companion

Dice rolls for Dungeons & Dragons games in Slack, including inside a Huddle chat.

The app is called Dice Companion and its bot user is Nat20; this repository and the npm package are named `ddslack`.

## Usage

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

## Limits and load

- **One roll every 3 seconds per person**, across every way to roll. A roll inside the wait gets a private note with the seconds left; the More options form keeps its values, so pressing Roll again works. A type that does not fit the die does not start the wait.
- **Slack's rate limits**: `chat.update` and `chat.delete` allow about 50 calls a minute per workspace, and `chat.postMessage` about one message a second per channel. Each reveal is one update. Shrinking the previous roll is a second one, done only while fewer than 30 updates went out in the last minute. Past 45, rolls skip the suspense and post their result at once, so no roll waits on an update that Slack would refuse. Shrinking, removing the picker and crit reactions use a client that gives up on a rate limit instead of pausing every roll behind it.
- **Retries**: Slack calls time out after 10 seconds and retry twice at most. A reveal holds its conversation's queue for 20 seconds at most. If a reveal fails, the message changes to "This roll could not be shown. Please roll again." instead of tumbling forever. If a post fails, the roller gets a private note.
- **Rolls**: at most 100 dice per roll across all terms, 20 terms, 1,000 sides and 100 characters of notation. Reasons are cut to 80 characters, and roll text is cut to Slack's 3,000-character block limit. Roll text is posted verbatim, and `@here`, `@channel` and `@everyone` in a reason are broken with a zero-width space, so a reason never notifies anyone.
- **The form** answers Slack within 2 seconds. A roll still posting by then finishes in the background, so a second press cannot roll twice.

## App Home

Opening the app in Slack shows a Home tab with a **Message style** setting and a guide. The setting is per person and changes how their own rolls read: *Beginner* (the default) explains each roll in plain sentences, such as "rolled two d20 with disadvantage: 8 and 11. Disadvantage keeps the lower one: 8", and spells out target numbers as "Needed 15 or more: Success"; *Expert* uses D&D notation, such as "rolled `2d20kl1`: [8, ~11~] = 8". The guide covers how to roll, which die to use (with SRD damage examples), roll notation, what the gold, red and faded dice mean, and how to invite the bot. The tab is published with `views.publish` when the `app_home_opened` event arrives. The Messages tab is off. The About tab shows the long description from `manifest.json`.

## When the bot responds

Only when explicitly invoked: by mentioning it, with `/roll`, with its button, or with its shortcut. Besides its mentions, it receives only `app_home_opened` (someone opened its Home tab) and `app_uninstalled` and `tokens_revoked` (a workspace removed it). None of them carry messages. Mentioning another person, pasting a link, or typing "d20" in a conversation produces no response. The app does not subscribe to channel messages and does not request history-read permissions (`tests/manifest.test.ts` checks this).

The bot must be a member of the channel (`/invite @Nat20`) to receive mentions. Slack does not deliver mentions in direct messages.

## Installation

1. At [api.slack.com/apps](https://api.slack.com/apps), choose **Create New App > From a manifest**, select the workspace, and paste `manifest.json`. To run your own copy, first replace `ddslack.tbelt.online` in its `redirect_urls` with your own HTTPS host, and set `PUBLIC_BASE_URL` to the same origin.
2. Install the app in the workspace.
3. Under **Basic Information > App-Level Tokens**, create a token with the `connections:write` scope.
4. Save the tokens outside the repository. The script asks for them with hidden input and writes `~/secrets/ddslack/local.env` with mode 600:

   ```sh
   ./scripts/setup-env.sh
   ```

5. Install dependencies and start. `pnpm dev` loads that file through `APP_ENV_FILE` and listens on port 8787:

   ```sh
   pnpm install
   pnpm dev
   ```

## Development

```sh
pnpm test        # tests
pnpm typecheck   # types
pnpm lint        # lint
pnpm build       # compiles to dist/
```

The die images in `assets/dice/` are generated from one 3D style spec (real polyhedra, one light, one camera), so every die shares its size, shading, palette and number placement. The scripts need Python 3 with Pillow and NumPy (`pip install pillow numpy`). To change the design, edit `scripts/render-dice.py`, rerun it with a bold TrueType font, and bump the `/dice/v2/` prefix in `lib/assets.ts` so Slack fetches the new images:

```sh
python3 scripts/render-dice.py path/to/Roboto-Bold.ttf --sheet /tmp/dice-sheet.png
```

The app icon (`assets/brand/app-icon.png`, 1024 px) comes from the same renderer: `python3 scripts/render-avatar.py path/to/Roboto-Bold.ttf gold assets/brand/app-icon.png`. Upload it in the app settings under **Basic Information > Display Information**; Slack apps cannot set their icon through the API.

`app.ts` starts the app; `listeners/` groups handlers by interaction type and `lib/` holds the dice, message, and target logic.

## Configuration

The app reads environment variables and the dotenv file named by `APP_ENV_FILE` (`KEY='value'` lines). Variables set in the environment win over the file. `.env.example` lists every key with dummy values.

| Key | Secret | Default |
|---|---|---|
| `SLACK_APP_TOKEN` | yes | |
| `SLACK_BOT_TOKEN` | yes | The home workspace's bot token. Required unless distribution is on; with distribution on, the home workspace keeps using it until it installs through the link |
| `SLACK_CLIENT_ID` | no | Distribution: set all three of these or none |
| `SLACK_CLIENT_SECRET` | yes | Distribution |
| `APP_SECRET` | yes | Distribution: at least 32 random characters. Keys the OAuth state, the encryption of stored installations and the strip URL signatures. Changing it makes the stored installations unreadable, so every workspace must install again |
| `LOG_LEVEL` | no | `info` |
| `DATA_DIR` | no | `data` in development; the image fixes it to `/app/data`, the persistent mount, so it cannot point at the image or `/tmp`. Holds `preferences.json` (each person's message style) and, with distribution on, `installations.json` |
| `PUBLIC_BASE_URL` | no | unset: rolls are text only. Set it to the app's public HTTPS origin to show die images. Slack fetches the images from the internet, so in development this needs a tunnel to port 8787 |
| `PORT` | no | `8080` (the container contract; `pnpm dev` uses 8787) |

Socket Mode does not use a signing secret, so the app has none.

## Installing in other workspaces

With `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and `APP_SECRET` set, any workspace can install the app from `<PUBLIC_BASE_URL>/slack/install` (in production, https://ddslack.tbelt.online/slack/install). The link sends the person to Slack to approve the four bot scopes; Slack then returns to `/slack/oauth_redirect`, which stores the workspace's installation and opens the app's Home tab in Slack. Installs started from that link carry an OAuth `state` that is signed and tied to the browser with a cookie, so a forged or replayed one gets 400. Installs started inside Slack (the Sharable URL or Add to Slack button in Manage Distribution, or Install to Workspace in the app settings) come back with no state and are accepted, since their code can only install the app in the workspace of whoever approved it. The log records each install and failed install.

Installations (bot token and ids per workspace) live in `DATA_DIR/installations.json`, encrypted with AES-256-GCM under a key derived from `APP_SECRET`. A file that cannot be decrypted stops the app at startup rather than being overwritten. When a workspace uninstalls the app or revokes its bot token (`app_uninstalled`, `tokens_revoked`), its installation is deleted. Losing the file means each workspace installs again; nothing else is lost.

The app keeps Socket Mode: one connection receives every workspace's events. Socket Mode apps can be distributed with a link but cannot be listed in the Slack Marketplace.

## Container and deploy

The app connects to Slack over Socket Mode, an outbound WebSocket. Its only listening port is `8080` on `0.0.0.0`, which serves `GET /healthz` (200 while the Slack connection is open, 503 otherwise), the die images under `/dice/v2/` and, with distribution on, `/slack/install` and `/slack/oauth_redirect`. The images are loaded into memory at startup and served with long-lived cache headers. Rows of dice (`/dice/v2/strip/<tag>/...`) are composed from those images on first request and kept in memory. The tag is an HMAC of the strip name, keyed from `APP_SECRET` (or from the bot token when distribution is off), so only names the app wrote are composed; a wrong tag gets 404. Untagged strip names from messages posted before signing are still served, but composing a new one is limited to 2 a second (bursts of 10); new signed strips are limited to 10 a second (bursts of 50), since a member could collect signed names and replay them. Beyond that the answer is 503 with `no-store`, and names that are not valid strips never use up the budget. Changing that key changes the tags, so strips not yet cached for older messages stop loading. Any other path returns 404.

`compose.yml` defines one service, `app`, running as user `10001` with a read-only root filesystem, all capabilities dropped, `no-new-privileges`, limits of 192 MB and 0.25 CPU, and `./data` as its only mount. The state is `./data/preferences.json` (each person's message style, keyed by Slack user ID) and, with distribution on, `./data/installations.json` (encrypted installations). It must be writable by the container user (10001). It needs no backups: if it is lost, everyone falls back to Beginner. When it cannot be written, styles still apply until the next restart and the log says so.

The log has one `[interaction]` line per interaction that reaches the app: the action or form, the channel and the kind of message clicked, without user IDs or text. A click with no matching line never reached the app. When the **More options** form fails to open, the log records Slack's error code and the person who clicked gets a private note. Slack warnings on a roll message are logged with the call and the block layout that drew them.

`.github/workflows/deploy.yml` runs lint, typecheck, tests and build on every push and pull request. On pushes to `main`, when the repository's `VPS_DEPLOY_ENABLED` variable is `true`, it packages the repository and uploads it to the production server over SSH through Cloudflare Access. Pull requests from forks never run that job.

To run the image elsewhere, pass the variables from the Configuration table to the container yourself (for example `docker run --env-file`, or an `environment` block in your own compose file). The production platform injects them, so `compose.yml` has none.

## License

Copyright (C) 2026 tBeltty

Dice Companion is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the full text.

The die images and the app icon in `assets/` are generated by the scripts in `scripts/` and are covered by the same license. The digits are drawn with Roboto Bold (Apache License 2.0), which is not included in the repository.

This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode. The app uses its rules for advantage, critical hits, death saving throws and ability scores, and its weapon and spell damage dice in the Home tab examples.

Dungeons & Dragons is a trademark of Wizards of the Coast LLC. Dice Companion is not affiliated with, endorsed by or sponsored by Wizards of the Coast.
