// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOT_SCOPES, REDIRECT_PATH } from '../lib/install.js';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

// Guards the invocation rule: the app must not read channel messages it was not summoned in.
describe('manifest permissions', () => {
  it('subscribes only to its own mentions, the Home tab opening and uninstalls', () => {
    // None of these carry channel messages: app_home_opened says someone opened the app, and
    // app_uninstalled and tokens_revoked let the app forget a workspace's token.
    expect(manifest.settings.event_subscriptions.bot_events).toEqual([
      'app_mention',
      'app_home_opened',
      'app_uninstalled',
      'tokens_revoked',
    ]);
  });

  it('keeps the Messages tab off, so nobody can send the bot direct messages', () => {
    expect(manifest.features.app_home).toMatchObject({ home_tab_enabled: true, messages_tab_enabled: false });
  });

  it('fits the App Directory text limits', () => {
    expect(manifest.display_information.name.length).toBeLessThanOrEqual(35);
    expect(manifest.display_information.description.length).toBeLessThanOrEqual(140);
    expect(manifest.display_information.long_description.length).toBeLessThanOrEqual(4000);
  });

  it('requests no history or extra read scopes', () => {
    // reactions:write only adds the crit reactions; it grants no read access.
    expect([...manifest.oauth_config.scopes.bot].sort()).toEqual([
      'app_mentions:read',
      'chat:write',
      'commands',
      'reactions:write',
    ]);
  });

  it('asks other workspaces for exactly the scopes in the manifest', () => {
    expect([...BOT_SCOPES].sort()).toEqual([...manifest.oauth_config.scopes.bot].sort());
  });

  it("sends installs back to the app's own OAuth redirect", () => {
    const [url, ...others] = manifest.oauth_config.redirect_urls;
    expect(others).toEqual([]);
    expect(url).toMatch(/^https:\/\/[^/]+\/slack\/oauth_redirect$/);
    expect(new URL(url).pathname).toBe(REDIRECT_PATH);
  });

  it('runs over Socket Mode', () => {
    expect(manifest.settings.socket_mode_enabled).toBe(true);
  });
});
