# Architecture and operations

How the app is built, how it behaves under load, and how it is deployed.

## Limits and load

- **One roll every 3 seconds per person**, across every way to roll. A roll inside the wait gets a private note with the seconds left; the More options form keeps its values, so pressing Roll again works. A type that does not fit the die does not start the wait.
- **Slack's rate limits**: `chat.update` and `chat.delete` allow about 50 calls a minute per workspace, and `chat.postMessage` about one message a second per channel. Each reveal is one update. Shrinking the previous roll is a second one, done only while fewer than 30 updates went out in the last minute. Past 45, rolls skip the suspense and post their result at once, so no roll waits on an update that Slack would refuse. Shrinking, removing the picker and crit reactions use a client that gives up on a rate limit instead of pausing every roll behind it.
- **Retries**: Slack calls time out after 10 seconds and retry twice at most. A reveal holds its conversation's queue for 20 seconds at most. If a reveal fails, the message changes to "This roll could not be shown. Please roll again." instead of tumbling forever. If a post fails, the roller gets a private note.
- **Rolls**: at most 100 dice per roll across all terms, 20 terms, 1,000 sides and 100 characters of notation. Reasons are cut to 80 characters, and roll text is cut to Slack's 3,000-character block limit. Roll text is posted verbatim, and `@here`, `@channel` and `@everyone` in a reason are broken with a zero-width space, so a reason never notifies anyone.
- **The form** answers Slack within 2 seconds. A roll still posting by then finishes in the background, so a second press cannot roll twice.

## Server, state and deploy

The app connects to Slack over Socket Mode, an outbound WebSocket. Its only listening port is `8080` on `0.0.0.0`, which serves `GET /healthz` (200 while the Slack connection is open, 503 otherwise), the die images under `/dice/v2/` and, with distribution on, `/slack/install` and `/slack/oauth_redirect`. The images are loaded into memory at startup and served with long-lived cache headers. Rows of dice (`/dice/v2/strip/<tag>/...`) are composed from those images on first request and kept in memory. The tag is an HMAC of the strip name, keyed from `APP_SECRET` (or from the bot token when distribution is off), so only names the app wrote are composed; a wrong tag gets 404. Untagged strip names from messages posted before signing are still served, but composing a new one is limited to 2 a second (bursts of 10); new signed strips are limited to 10 a second (bursts of 50), since a member could collect signed names and replay them. Beyond that the answer is 503 with `no-store`, and names that are not valid strips never use up the budget. Changing that key changes the tags, so strips not yet cached for older messages stop loading. Any other path returns 404.

`compose.yml` defines one service, `app`, running as user `10001` with a read-only root filesystem, all capabilities dropped, `no-new-privileges`, limits of 192 MB and 0.25 CPU, and `./data` as its only mount. The state is `./data/preferences.json` (each person's message style, keyed by Slack user ID) and, with distribution on, `./data/installations.json` (encrypted installations). It must be writable by the container user (10001). It needs no backups: if it is lost, everyone falls back to Beginner. When it cannot be written, styles still apply until the next restart and the log says so.

The log has one `[interaction]` line per interaction that reaches the app: the action or form, the channel and the kind of message clicked, without user IDs or text. A click with no matching line never reached the app. When the **More options** form fails to open, the log records Slack's error code and the person who clicked gets a private note. Slack warnings on a roll message are logged with the call and the block layout that drew them.

`.github/workflows/deploy.yml` runs lint, typecheck, tests and build on every push and pull request. On pushes to `main`, when the repository's `VPS_DEPLOY_ENABLED` variable is `true`, it packages the repository and uploads it to the production server over SSH through Cloudflare Access. Pull requests from forks never run that job.

## Code layout and assets

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
