import type { InstallationStore } from '@slack/oauth';
import type { Cooldown } from '../lib/cooldown.js';
import type { Preferences } from '../lib/preferences.js';
import type { Table } from '../lib/table.js';

export interface ListenerOptions {
  /** Public HTTPS origin that serves the die images; without it rolls are text only. */
  publicBaseUrl?: string;
  /** Runs public rolls: suspense, reveal and tidying of older rolls. */
  table: Table;
  /** Each person's message style (beginner or expert). */
  preferences: Preferences;
  /** The wait between two rolls by the same person. */
  cooldown: Cooldown;
  /** Where other workspaces' installations live, when the app is distributed. */
  installations?: InstallationStore;
}

/** The bot token Bolt resolved for the workspace a request came from, ready to spread into a roll. */
export function tokenOf(context: { botToken?: string } | undefined): { token?: string } {
  return context?.botToken ? { token: context.botToken } : {};
}
