import { fileURLToPath } from 'node:url';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BlockAction, Logger } from '@slack/bolt';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadDiceImages, readStripPath, setStripKey, stripImageName } from '../lib/assets.js';
import { Cooldown } from '../lib/cooldown.js';
import { parseDice } from '../lib/dice.js';
import { createAppServer, TokenBucket } from '../lib/http.js';
import { escapeMrkdwn, rollText } from '../lib/messages.js';
import { Preferences } from '../lib/preferences.js';
import { performRoll } from '../lib/roll.js';
import { type ChatApi, Table } from '../lib/table.js';
import { encodeTarget } from '../lib/target.js';
import { targetFromAction } from '../listeners/actions/action-target.js';
import type { ListenerOptions } from '../listeners/options.js';
import { rollModalSubmit } from '../listeners/views/roll-modal.js';

const ASSETS = fileURLToPath(new URL('../assets/dice/', import.meta.url));
const silent = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger;

describe('signed strip URLs', () => {
  afterEach(() => setStripKey(null));
  const dice = [
    { sides: 20, value: 15 },
    { sides: 20, value: 4, dropped: true },
  ];

  it('tags each strip with a signature only the app can make', () => {
    setStripKey('bot-token');
    const name = stripImageName(dice);
    expect(name).toMatch(/^strip\/[0-9a-f]{16}\/d20-15_d20-4x\.png$/);
    expect(readStripPath(name)).toEqual({ name: 'strip/d20-15_d20-4x.png', signed: true });
  });

  it('refuses a forged or copied tag', () => {
    setStripKey('bot-token');
    const [, , file] = stripImageName(dice).split('/');
    expect(readStripPath(`strip/0000000000000000/${file}`)).toBeNull();
    const other = stripImageName([{ sides: 6, value: 1 }, { sides: 6, value: 2 }]).split('/')[1];
    expect(readStripPath(`strip/${other}/${file}`)).toBeNull();
    setStripKey('another-token');
    expect(readStripPath(`strip/${stripImageName(dice).split('/')[1]}/x.png`)).toBeNull();
  });

  it('still reads unsigned names from messages posted before signing', () => {
    expect(readStripPath('strip/d20-15_d20-4x.png')).toEqual({ name: 'strip/d20-15_d20-4x.png', signed: false });
    expect(readStripPath('strip/a/b/c.png')).toBeNull();
  });
});

describe('strip endpoint under load', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    setStripKey(null);
    await close?.();
    close = undefined;
  });

  async function serve(bucket: TokenBucket): Promise<string> {
    const server = createAppServer({ isReady: () => true, images: loadDiceImages(ASSETS), unsignedStrips: bucket });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    close = () => new Promise((resolve) => server.close(() => resolve()));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/dice/v2/`;
  }

  it('composes signed strips on their own budget and refuses forged ones', async () => {
    setStripKey('bot-token');
    const base = await serve(new TokenBucket(0, 0));
    const name = stripImageName([{ sides: 6, value: 3 }, { sides: 6, value: 5 }]);
    expect((await fetch(`${base}${name}`)).status).toBe(200);
    const forged = await fetch(`${base}strip/0123456789abcdef/d6-3_d6-6.png`);
    expect(forged.status).toBe(404);
    expect(forged.headers.get('cache-control')).toBe('no-store');
  });

  it('spends no budget on names that are not strips', async () => {
    const base = await serve(new TokenBucket(0, 1));
    for (let i = 0; i < 5; i++) expect((await fetch(`${base}strip/d6-9_d6-1.png`)).status).toBe(404);
    expect((await fetch(`${base}strip/d6-1_d6-2.png`)).status).toBe(200);
  });

  it('rations new unsigned strips and keeps serving the ones already made', async () => {
    const base = await serve(new TokenBucket(0, 1));
    expect((await fetch(`${base}strip/d6-1_d6-2.png`)).status).toBe(200);
    const busy = await fetch(`${base}strip/d6-1_d6-3.png`);
    expect(busy.status).toBe(503);
    expect(busy.headers.get('cache-control')).toBe('no-store');
    expect((await fetch(`${base}strip/d6-1_d6-2.png`)).status).toBe(200);
  });

  it('refills the bucket over time', () => {
    let now = 0;
    const bucket = new TokenBucket(2, 1, () => now);
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
    now = 500;
    expect(bucket.take()).toBe(true);
  });
});

describe('roll text stays inside Slack limits', () => {
  it('caps the dice across all terms of a roll', () => {
    expect(parseDice('100d20').ok).toBe(true);
    const many = parseDice('60d20+60d20');
    expect(many.ok).toBe(false);
    if (!many.ok) expect(many.error).toContain('at most 100 dice');
  });

  it('shortens a long reason', () => {
    const roll = performRoll({ expression: '1d20', userId: 'U1', reason: 'x'.repeat(5000), rng: () => 7 });
    expect(roll.ok && roll.text.length).toBeLessThan(200);
    expect(roll.ok && roll.text).toContain('x…');
  });

  it('fits any text into one block and reads it literally', () => {
    const block = rollText('a'.repeat(5000));
    expect(block.text.length).toBe(3000);
    expect(block.verbatim).toBe(true);
  });

  it('keeps @here, @channel and @everyone in a reason from pinging anyone', () => {
    expect(escapeMrkdwn('@here look @Channel')).toBe('@\u200Bhere look @\u200BChannel');
    expect(escapeMrkdwn('<!everyone>')).toBe('&lt;!everyone&gt;');
  });
});

describe('a roll that cannot be revealed', () => {
  it('replaces the tumbling die with a short notice', async () => {
    const calls: Array<{ method: string; text?: unknown }> = [];
    let updates = 0;
    const client: ChatApi = {
      chat: {
        postMessage: async () => ({ ts: '1700000001.000001' }),
        update: async (args) => {
          calls.push({ method: 'update', text: args.text });
          if (updates++ === 0) throw Object.assign(new Error('invalid_blocks'), { data: { error: 'invalid_blocks' } });
          return {};
        },
        delete: async () => ({}),
      },
      reactions: { add: async () => ({}) },
    };
    const table = new Table({ client, logger: silent, sleep: async () => {} });
    await table.roll({ target: { channel: 'C1' }, userId: 'U1', expression: '1d6', rng: () => 3 });
    await table.drain();
    expect(calls.at(-1)?.text).toBe('This roll could not be shown. Please roll again.');
  });

  it('sends the optional tidying through the client that gives up on rate limits', async () => {
    const main: string[] = [];
    const tidy: string[] = [];
    const fake = (log: string[]): ChatApi => ({
      chat: {
        postMessage: async () => {
          log.push('post');
          return { ts: `1700000001.00000${log.length}` };
        },
        update: async () => void log.push('update'),
        delete: async () => void log.push('delete'),
      },
      reactions: { add: async () => void log.push('reaction') },
    });
    const table = new Table({ client: fake(main), tidyClient: fake(tidy), logger: silent, sleep: async () => {} });
    table.rememberPicker({ channel: 'C1' }, '1700000000.000009');
    await table.roll({ target: { channel: 'C1' }, userId: 'U1', expression: '1d20', rng: () => 20 });
    await table.drain();
    await table.roll({ target: { channel: 'C1' }, userId: 'U2', expression: '1d6', rng: () => 3 });
    await table.drain();
    expect(main).toEqual(['post', 'update', 'post', 'update']);
    expect(tidy).toEqual(['delete', 'reaction', 'update']);
  });
});

describe('where a click may roll', () => {
  const body = (channel: string) =>
    ({ type: 'block_actions', channel: { id: channel }, container: {}, response_url: 'https://hooks.slack.com/x/' }) as unknown as BlockAction;

  it('refuses a picker whose stored channel is not where it was clicked', () => {
    const value = encodeTarget({ channel: 'C1', threadTs: '1700000000.000100' });
    expect(targetFromAction(body('C1'), value)).toEqual({ channel: 'C1', threadTs: '1700000000.000100' });
    expect(targetFromAction(body('C2'), value)).toBeNull();
  });
});

describe('roll form answers Slack in time', () => {
  afterEach(() => vi.useRealTimers());

  it('closes the form after 2 seconds even when posting is slow, and posts once', async () => {
    vi.useFakeTimers();
    let finish: () => void = () => {};
    const rolls: string[] = [];
    const handler = rollModalSubmit({
      table: {
        roll: (o: { expression: string }) =>
          new Promise<void>((resolve) => {
            rolls.push(o.expression);
            finish = resolve;
          }),
      },
      preferences: { style: () => 'beginner' },
      cooldown: new Cooldown(),
    } as unknown as ListenerOptions);
    const acks: unknown[] = [];
    const done = handler({
      ack: async (response?: unknown) => void acks.push(response ?? 'ok'),
      logger: silent,
      client: {},
      body: { user: { id: 'U1' } },
      view: {
        private_metadata: encodeTarget({ channel: 'C1' }),
        state: {
          values: {
            die: { value: { selected_option: { value: '20' } } },
            count: { value: { value: '1' } },
            modifier: { value: { value: '0' } },
            type: { value: { selected_option: { value: 'normal' } } },
          },
        },
      },
    } as never);
    await vi.advanceTimersByTimeAsync(1999);
    expect(acks).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(acks).toEqual(['ok']);
    finish();
    await done;
    expect(rolls).toEqual(['1d20']);
  });
});

describe('a damaged preferences file', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('is set aside before anything can overwrite it', async () => {
    dir = mkdtempSync(join(tmpdir(), 'prefs-'));
    writeFileSync(join(dir, 'preferences.json'), '{"users": {"U1": ');
    const warnings: string[] = [];
    const prefs = Preferences.inDirectory(dir, (m) => warnings.push(m));
    await prefs.setStyle('U2', 'expert');
    const files = readdirSync(dir);
    expect(files.some((f) => f.startsWith('preferences.json.corrupt-'))).toBe(true);
    expect(files).toContain('preferences.json');
    expect(warnings.join(' ')).toContain('moved it to');
  });

  it('treats valid JSON of the wrong shape as damaged too', () => {
    dir = mkdtempSync(join(tmpdir(), 'prefs-'));
    writeFileSync(join(dir, 'preferences.json'), 'null');
    expect(Preferences.inDirectory(dir).style('U1')).toBe('beginner');
    expect(readdirSync(dir).some((f) => f.startsWith('preferences.json.corrupt-'))).toBe(true);
  });
});

describe('a roll Slack refuses', () => {
  it('tells the roller to wait when Slack is rate limiting', async () => {
    const { rollFailedMessage } = await import('../lib/publish.js');
    expect(rollFailedMessage(new Error('A rate limit was exceeded (url: chat.postMessage, retry-after: 3)'))).toContain(
      'Slack is busy'
    );
    expect(rollFailedMessage(Object.assign(new Error('x'), { code: 'slack_webapi_rate_limited_error' }))).toContain(
      'Slack is busy'
    );
    expect(rollFailedMessage(new Error('channel_not_found'))).toBe("Couldn't post the roll. Please try again.");
  });
});

describe('Slack update budget', () => {
  it('posts the result at once, without suspense, once the minute budget for updates is spent', async () => {
    const rolling = new Set<string>();
    const posts: string[] = [];
    let updates = 0;
    const client: ChatApi = {
      chat: {
        postMessage: async (a) => {
          posts.push(a.text);
          const ts = `1700000001.${String(posts.length).padStart(6, '0')}`;
          if (a.text.includes('is rolling')) rolling.add(ts);
          return { ts };
        },
        update: async (a) => {
          updates++;
          rolling.delete(a.ts);
          return {};
        },
        delete: async () => ({}),
      },
      reactions: { add: async () => ({}) },
    };
    const table = new Table({ client, logger: silent, sleep: async () => {}, now: () => 0 });
    for (let i = 0; i < 60; i++) {
      await table.roll({ target: { channel: 'C1' }, userId: `U${i}`, expression: '1d6', rng: () => 4 });
      await table.drain();
    }
    expect(updates).toBeLessThanOrEqual(45);
    expect(rolling.size).toBe(0);
    expect(posts.at(-1)).toBe('<@U59> rolled a d6: *4*');
  });
});
