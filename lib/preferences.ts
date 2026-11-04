// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEFAULT_STYLE, type MessageStyle } from './messages.js';

interface Stored {
  users: Record<string, { style?: MessageStyle }>;
}

/**
 * Each person's message style, kept in one small JSON file under the data directory. Writes go
 * to a temporary file that then replaces the old one, so a crash never leaves half a file.
 * When the file cannot be written the preference still applies until the next restart.
 */
export class Preferences {
  private readonly users = new Map<string, MessageStyle>();
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string | null,
    private readonly warn: (message: string) => void = () => {}
  ) {
    if (!file) return;
    try {
      const stored = JSON.parse(readFileSync(file, 'utf8')) as Stored | null;
      if (!stored || typeof stored !== 'object' || typeof stored.users !== 'object' || stored.users === null) {
        throw new SyntaxError('not a preferences file');
      }
      for (const [userId, prefs] of Object.entries(stored.users)) {
        if (prefs?.style === 'beginner' || prefs?.style === 'expert') this.users.set(userId, prefs.style);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      if (!(err instanceof SyntaxError)) {
        this.warn(`Cannot read ${file}: ${String(err)}`);
        return;
      }
      // Set an unreadable file aside, so the next save cannot overwrite what might be recovered.
      const aside = `${file}.corrupt-${Date.now()}`;
      try {
        renameSync(file, aside);
        this.warn(`Cannot read ${file} (${String(err)}); moved it to ${aside}.`);
      } catch {
        this.warn(`Cannot read ${file}: ${String(err)}`);
      }
    }
  }

  static inDirectory(dir: string, warn?: (message: string) => void): Preferences {
    return new Preferences(join(dir, 'preferences.json'), warn);
  }

  style(userId: string): MessageStyle {
    return this.users.get(userId) ?? DEFAULT_STYLE;
  }

  /** Records a style and saves the file; writes run one at a time. */
  setStyle(userId: string, style: MessageStyle): Promise<void> {
    this.users.set(userId, style);
    this.writing = this.writing.then(() => this.save());
    return this.writing;
  }

  private async save(): Promise<void> {
    if (!this.file) return;
    const stored: Stored = { users: {} };
    for (const [userId, style] of this.users) stored.users[userId] = { style };
    try {
      // /app/data already exists in the container; only a fresh development checkout needs it made.
      if (!existsSync(dirname(this.file))) mkdirSync(dirname(this.file), { recursive: true });
      const temp = `${this.file}.tmp`;
      writeFileSync(temp, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
      renameSync(temp, this.file);
    } catch (err) {
      this.warn(`Cannot save ${this.file}: ${(err as NodeJS.ErrnoException).code ?? String(err)}. Styles last until restart.`);
    }
  }
}
