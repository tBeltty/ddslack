import type { App } from '@slack/bolt';
import * as actions from './actions/index.js';
import * as commands from './commands/index.js';
import * as events from './events/index.js';
import type { ListenerOptions } from './options.js';
import * as interactions from './interactions.js';
import * as shortcuts from './shortcuts/index.js';
import * as views from './views/index.js';

export default function registerListeners(app: App, options: ListenerOptions): void {
  interactions.register(app);
  actions.register(app, options);
  commands.register(app, options);
  events.register(app, options);
  shortcuts.register(app);
  views.register(app, options);
}
