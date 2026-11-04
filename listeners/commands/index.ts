import type { App } from '@slack/bolt';
import type { ListenerOptions } from '../options.js';
import { roll } from './roll.js';

export function register(app: App, options: ListenerOptions): void {
  app.command('/roll', roll(options));
}
