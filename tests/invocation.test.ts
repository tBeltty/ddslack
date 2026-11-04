import { describe, expect, it } from 'vitest';
import { isExplicitMention, RecentKeys, replyThreadTs } from '../lib/invocation.js';

const BOT = 'UBOT123';
const mention = (overrides: Record<string, unknown> = {}) => ({
  type: 'app_mention',
  user: 'UPLAYER1',
  text: `<@${BOT}> shall we roll?`,
  ts: '1700000000.000200',
  ...overrides,
});

describe('isExplicitMention', () => {
  it('accepts an app_mention that carries this bot ID', () => {
    expect(isExplicitMention(mention(), BOT)).toBe(true);
    expect(isExplicitMention(mention({ text: `hola <@${BOT}|ddslack>` }), BOT)).toBe(true);
  });

  describe('never reacts to anything that is not an explicit invocation', () => {
    it.each([
      ['a mention of a coworker', { type: 'message', text: '<@UCOWORKER> mira esto' }],
      ['a coworker mention even inside app_mention-shaped data', { text: '<@UCOWORKER> mira esto' }],
      ['a message event that mentions the bot', { type: 'message' }],
      ['a link', { type: 'message', text: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }],
      ['dice words in prose', { type: 'message', text: 'tiro un d20 para la partida de dnd' }],
      ['@channel and @here', { text: '<!channel> <!here> a jugar' }],
      ['another bot', { bot_id: 'BOTHER' }],
      ['a bot_message subtype', { subtype: 'bot_message' }],
      ['its own message', { user: BOT }],
      ['an event without author', { user: undefined }],
    ])('%s', (_label, overrides) => {
      expect(isExplicitMention(mention(overrides), BOT)).toBe(false);
    });

    it('when the bot user ID is unknown', () => {
      expect(isExplicitMention(mention(), undefined)).toBe(false);
    });
  });
});

describe('replyThreadTs', () => {
  it('stays in the thread (Huddle chat included) when invoked from a reply', () => {
    expect(replyThreadTs({ ts: '2.0', thread_ts: '1.0' })).toBe('1.0');
  });

  it('opens a thread under a top-level mention instead of posting to the channel', () => {
    expect(replyThreadTs({ ts: '2.0' })).toBe('2.0');
  });
});

describe('RecentKeys', () => {
  it('flags Slack retries as duplicates until the TTL expires', () => {
    let now = 0;
    const keys = new RecentKeys(1000, () => now);
    expect(keys.seen('C1:1.0')).toBe(false);
    expect(keys.seen('C1:1.0')).toBe(true);
    now = 1001;
    expect(keys.seen('C1:1.0')).toBe(false);
  });
});
