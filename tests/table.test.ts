import type { Logger } from '@slack/bolt';
import { describe, expect, it } from 'vitest';
import type { Rng } from '../lib/dice.js';
import type { RollMessage } from '../lib/roll.js';
import { type ChatApi, Table } from '../lib/table.js';

const BASE = 'https://ddslack.tbelt.online';
const THREAD = { channel: 'C1', threadTs: '1700000000.000100' };
const always = (value: number): Rng => () => value;

type Call = { method: string; args: Record<string, unknown> };

function fakeSlack(o: { failPost?: string; failReactions?: string } = {}) {
  const calls: Call[] = [];
  let next = 1;
  const record = (method: string) => async (args: Record<string, unknown>) => {
    calls.push({ method, args });
    return {};
  };
  const client: ChatApi = {
    chat: {
      postMessage: async (args) => {
        calls.push({ method: 'postMessage', args });
        if (o.failPost) throw Object.assign(new Error(o.failPost), { data: { error: o.failPost } });
        return { ts: `1700000001.00000${next++}` };
      },
      update: record('update'),
      delete: record('delete'),
    },
    reactions: {
      add: async (args) => {
        calls.push({ method: 'reactions.add', args });
        if (o.failReactions) throw Object.assign(new Error(o.failReactions), { data: { error: o.failReactions } });
        return {};
      },
    },
  };
  return { client, calls };
}

const silent = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger;

function table(slack: ReturnType<typeof fakeSlack>, extra: { responses?: Array<[string, RollMessage]> } = {}) {
  return new Table({
    client: slack.client,
    logger: silent,
    publicBaseUrl: BASE,
    sleep: async () => {},
    respond: async (url, message) => {
      extra.responses?.push([url, message]);
    },
  });
}

const blocksOf = (call: Call | undefined) => JSON.stringify(call?.args.blocks ?? []);

describe('a public roll', () => {
  it('posts the tumbling die, then reveals the result in the same message', async () => {
    const slack = fakeSlack();
    const t = table(slack);
    await t.roll({ target: THREAD, userId: 'U1', expression: '1d20', rng: always(17) });
    await t.drain();

    const [rolling, reveal] = slack.calls;
    expect(rolling?.method).toBe('postMessage');
    expect(rolling?.args).toMatchObject({ channel: 'C1', thread_ts: THREAD.threadTs, text: '<@U1> is rolling a d20…' });
    expect(blocksOf(rolling)).toContain(`${BASE}/dice/v2/d20-rolling.gif`);

    expect(reveal?.method).toBe('update');
    expect(reveal?.args).toMatchObject({ channel: 'C1', ts: '1700000001.000001', text: '<@U1> rolled a d20: *17*' });
    expect(blocksOf(reveal)).toContain(`${BASE}/dice/v2/d20-17.png`);
    expect(blocksOf(reveal)).toContain('"action_id":"roll"');
  });

  it('waits for the suspense before revealing', async () => {
    const slack = fakeSlack();
    const waits: number[] = [];
    const t = new Table({ client: slack.client, logger: silent, sleep: async (ms) => void waits.push(ms) });
    await t.roll({ target: THREAD, userId: 'U1', expression: '1d6', rng: always(4) });
    await t.drain();
    expect(waits).toEqual([1200]);
  });
});

describe('tidying the conversation', () => {
  it('shrinks the previous roll to one line without image or buttons', async () => {
    const slack = fakeSlack();
    const t = table(slack);
    await t.roll({ target: THREAD, userId: 'U1', expression: '1d20', rng: always(8) });
    await t.drain();
    await t.roll({ target: THREAD, userId: 'U2', expression: '1d6', rng: always(5) });
    await t.drain();

    const shrink = slack.calls.find((c) => c.method === 'update' && c.args.ts === '1700000001.000001' && c !== slack.calls[1]);
    expect(shrink?.args.text).toBe('<@U1> rolled a d20: *8*');
    expect(blocksOf(shrink)).toContain('"type":"context"');
    expect(blocksOf(shrink)).not.toContain('image');
    expect(blocksOf(shrink)).not.toContain('"action_id":"roll"');
  });

  it('leaves other threads alone', async () => {
    const slack = fakeSlack();
    const t = table(slack);
    await t.roll({ target: THREAD, userId: 'U1', expression: '1d20', rng: always(8) });
    await t.drain();
    await t.roll({ target: { channel: 'C1', threadTs: '1700000000.000999' }, userId: 'U2', expression: '1d6', rng: always(5) });
    await t.drain();
    expect(slack.calls.filter((c) => c.method === 'update')).toHaveLength(2);
  });

  it('removes the dice picker once someone rolls', async () => {
    const slack = fakeSlack();
    const t = table(slack);
    t.rememberPicker(THREAD, '1700000000.000500');
    await t.roll({ target: THREAD, userId: 'U1', expression: '1d20', rng: always(8) });
    await t.drain();
    expect(slack.calls).toContainEqual({ method: 'delete', args: { channel: 'C1', ts: '1700000000.000500' } });

    await t.roll({ target: THREAD, userId: 'U1', expression: '1d20', rng: always(9) });
    await t.drain();
    expect(slack.calls.filter((c) => c.method === 'delete')).toHaveLength(1);
  });

  it('leaves the roll revealed last in full when two rolls overlap', async () => {
    const slack = fakeSlack();
    const t = table(slack);
    await Promise.all([
      t.roll({ target: THREAD, userId: 'U1', expression: '1d20', rng: always(3) }),
      t.roll({ target: THREAD, userId: 'U2', expression: '1d20', rng: always(15) }),
    ]);
    await t.drain();

    const updates = slack.calls.filter((c) => c.method === 'update');
    expect(updates.map((c) => c.args.ts)).toEqual(['1700000001.000001', '1700000001.000002', '1700000001.000001']);
    expect(blocksOf(updates[2])).toContain('"type":"context"');
  });
});

describe('critical results', () => {
  it('celebrates a natural 20 with the large image and a reaction', async () => {
    const slack = fakeSlack();
    const t = table(slack);
    await t.roll({ target: THREAD, userId: 'U1', expression: '1d20', rng: always(20) });
    await t.drain();
    const reveal = slack.calls.find((c) => c.method === 'update');
    expect(blocksOf(reveal)).toContain(`${BASE}/dice/v2/d20-20-large.png`);
    expect(slack.calls).toContainEqual({
      method: 'reactions.add',
      args: { channel: 'C1', timestamp: '1700000001.000001', name: 'tada' },
    });
  });

  it('marks a natural 1 and keeps going if the reaction scope is missing', async () => {
    const slack = fakeSlack({ failReactions: 'missing_scope' });
    const t = table(slack);
    await t.roll({ target: THREAD, userId: 'U1', expression: '1d20', rng: always(1) });
    await t.drain();
    expect(blocksOf(slack.calls.find((c) => c.method === 'update'))).toContain('d20-1-large.png');
    expect(slack.calls.at(-1)?.args).toMatchObject({ name: 'skull' });
  });
});

describe('when the bot is not in the channel', () => {
  it('posts at once through the response URL, without suspense', async () => {
    const slack = fakeSlack({ failPost: 'not_in_channel' });
    const responses: Array<[string, RollMessage]> = [];
    const t = table(slack, { responses });
    const outcome = await t.roll({
      target: { channel: 'C1' },
      userId: 'U1',
      expression: '1d20',
      fallbackResponseUrl: 'https://hooks.slack.com/commands/T/1/x',
      rng: always(11),
    });
    expect(outcome).toBe('posted');
    expect(responses[0]?.[1].text).toBe('<@U1> rolled a d20: *11*');
    expect(slack.calls.filter((c) => c.method === 'update')).toHaveLength(0);
  });

  it('reports the error when there is no response URL to fall back on', async () => {
    const slack = fakeSlack({ failPost: 'not_in_channel' });
    await expect(table(slack).roll({ target: THREAD, userId: 'U1', expression: '1d20' })).rejects.toThrow();
  });
});
