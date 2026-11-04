# Self-hosting

Run your own copy of the app: create the Slack app, configure it, and run it locally or as a container.

## Create the Slack app

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

## Running the container

To run the image elsewhere, pass the variables from the Configuration table to the container yourself (for example `docker run --env-file`, or an `environment` block in your own compose file). The production platform injects them, so `compose.yml` has none.
