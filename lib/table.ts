// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Logger } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import type { Rng } from './dice.js';
import { compactBlocks, type MessageStyle } from './messages.js';
import { postToResponseUrl, slackErrorCode } from './publish.js';
import { performRoll, type RollMessage, type RollView, standardView } from './roll.js';
import type { RollTarget } from './target.js';

/** The Web API calls a table needs; WebClient satisfies it and tests pass a fake. */
export interface ChatApi {
  chat: {
    postMessage(args: { channel: string; text: string; blocks?: KnownBlock[]; thread_ts?: string }): Promise<{
      ts?: string;
    }>;
    update(args: { channel: string; ts: string; text: string; blocks?: KnownBlock[] }): Promise<unknown>;
    delete(args: { channel: string; ts: string }): Promise<unknown>;
  };
  reactions: {
    add(args: { channel: string; timestamp: string; name: string }): Promise<unknown>;
  };
}

interface Conversation {
  /** The newest revealed roll: the only one that keeps its image and buttons. */
  latest?: { ts: string; compact: RollMessage };
  /** The dice picker posted after a mention; removed once someone rolls. */
  pickerTs?: string;
  touchedAt: number;
}

/** The Web API clients for one workspace. */
export interface WorkspaceClients {
  client: ChatApi;
  /**
   * For the optional calls (shrinking the previous roll, removing the picker, crit reactions).
   * A client that gives up on rate limits keeps them from holding up the rolls themselves.
   */
  tidy: ChatApi;
}

interface Workspace extends WorkspaceClients {
  /** When each recent chat.update went out; Slack counts its rate limit per workspace. */
  updatesAt: number[];
}

export interface TableOptions {
  /** The clients for a workspace's bot token; each installed workspace has its own. */
  clientsFor?: (token: string) => WorkspaceClients;
  /** The clients used when a roll names no token: the single-workspace setup, and tests. */
  client?: ChatApi;
  tidyClient?: ChatApi;
  logger: Logger;
  publicBaseUrl?: string;
  suspenseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  respond?: (url: string, message: RollMessage) => Promise<void>;
  /** Each roller's message style; beginner when nothing is stored. */
  styleOf?: (userId: string) => MessageStyle;
}

export const SUSPENSE_MS = 1200;
/** Longest a reveal may hold its conversation's queue before the next roll goes ahead anyway. */
export const REVEAL_TIMEOUT_MS = 20_000;
const REVEAL_FAILED = 'This roll could not be shown. Please roll again.';
/**
 * Slack allows chat.update about 50 times a minute per workspace (Tier 3), and every roll needs
 * one to reveal. Shrinking the previous roll costs another, so it only happens while fewer than
 * this many updates went out in the last minute; past that, older rolls simply stay in full.
 */
export const SHRINK_BUDGET_PER_MINUTE = 30;
/** Past this many updates in a minute, rolls skip the suspense and post their result at once. */
export const REVEAL_BUDGET_PER_MINUTE = 45;
const FORGET_AFTER_MS = 24 * 60 * 60_000;
const NOT_A_MEMBER = new Set(['not_in_channel', 'channel_not_found']);

/**
 * Runs public rolls per conversation (a thread, a Huddle chat or a channel): posts the
 * tumbling die, reveals the result after a short suspense, shrinks the previous roll to one
 * line and removes the picker. Reveals in one conversation run one at a time, so the roll
 * revealed last is the one left in full.
 *
 * State lives in memory: after a restart the roll revealed before it simply stays in full.
 */
export class Table {
  private readonly conversations = new Map<string, Conversation>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly pending = new Set<Promise<void>>();
  private readonly workspaces = new Map<string, Workspace>();
  private readonly o: Required<Omit<TableOptions, 'publicBaseUrl' | 'client' | 'tidyClient' | 'clientsFor'>> &
    Pick<TableOptions, 'publicBaseUrl' | 'client' | 'tidyClient' | 'clientsFor'>;

  constructor(options: TableOptions) {
    this.o = {
      suspenseMs: SUSPENSE_MS,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: Date.now,
      respond: (url, message) => postToResponseUrl(url, message, false),
      styleOf: () => 'beginner',
      ...options,
    };
  }

  private workspace(token: string | undefined): Workspace {
    const key = token ?? '';
    let workspace = this.workspaces.get(key);
    if (!workspace) {
      const clients =
        token && this.o.clientsFor
          ? this.o.clientsFor(token)
          : this.o.client
            ? { client: this.o.client, tidy: this.o.tidyClient ?? this.o.client }
            : null;
      if (!clients) throw new Error('No Slack client for this workspace');
      workspace = { ...clients, updatesAt: [] };
      this.workspaces.set(key, workspace);
    }
    return workspace;
  }

  rememberPicker(target: RollTarget, ts: string): void {
    this.conversation(target).pickerTs = ts;
  }

  /**
   * Rolls in public. Returns once the "rolling" message is posted; the reveal finishes in
   * the background (await `drain()` to wait for it). When the bot is not in the channel and a
   * response URL is given, the roll is posted at once through that URL, without suspense.
   */
  async roll(o: {
    target: RollTarget;
    userId: string;
    /** A prepared roll (death save, ability scores); otherwise `expression` is rolled. */
    view?: RollView;
    expression?: string;
    reason?: string;
    dc?: number;
    critical?: boolean;
    fallbackResponseUrl?: string;
    /** The bot token of the workspace the roll happens in. */
    token?: string;
    rng?: Rng;
  }): Promise<'revealing' | 'posted'> {
    const workspace = this.workspace(o.token);
    const view = o.view ?? this.standard(o);
    const target: RollTarget = { channel: o.target.channel, ...(o.target.threadTs ? { threadTs: o.target.threadTs } : {}) };
    // A reveal is an update; when Slack's budget for them is nearly spent, show the result directly.
    const direct = this.updatesInLastMinute(workspace) >= REVEAL_BUDGET_PER_MINUTE;
    if (!direct) this.countUpdate(workspace);
    const first = direct ? view.reveal(target) : view.rolling;
    let posted: { ts?: string };
    try {
      posted = await workspace.client.chat.postMessage({
        channel: target.channel,
        ...first,
        ...(target.threadTs ? { thread_ts: target.threadTs } : {}),
      });
      this.noteWarnings(direct ? 'post result' : 'post rolling', posted, first.blocks);
    } catch (err) {
      if (o.fallbackResponseUrl && NOT_A_MEMBER.has(slackErrorCode(err) ?? '')) {
        await this.o.respond(o.fallbackResponseUrl, view.instant);
        return 'posted';
      }
      throw err;
    }
    if (!posted.ts) throw new Error('postMessage returned no ts');

    const task = this.reveal(workspace, target, posted.ts, direct ? null : view.reveal(target), view.compact, view.natural)
      .catch((err) => this.o.logger.error(`[table] reveal failed: ${slackErrorCode(err) ?? String(err)}`))
      .finally(() => this.pending.delete(task));
    this.pending.add(task);
    return 'revealing';
  }

  private standard(o: {
    userId: string;
    expression?: string;
    reason?: string;
    dc?: number;
    critical?: boolean;
    rng?: Rng;
  }): RollView {
    const roll = performRoll({
      expression: o.expression ?? '',
      userId: o.userId,
      ...(o.reason ? { reason: o.reason } : {}),
      ...(o.dc !== undefined ? { dc: o.dc } : {}),
      ...(o.critical ? { critical: true } : {}),
      ...(o.rng ? { rng: o.rng } : {}),
      ...(this.o.publicBaseUrl ? { publicBaseUrl: this.o.publicBaseUrl } : {}),
      style: this.o.styleOf(o.userId),
    });
    if (!roll.ok) throw new Error(roll.error);
    return standardView(roll, o.userId, this.o.publicBaseUrl);
  }

  /** Waits for every reveal in flight, for example before shutting down. */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  private async reveal(
    workspace: Workspace,
    target: RollTarget,
    ts: string,
    /** The result to reveal after the suspense; null when the post already showed it. */
    full: RollMessage | null,
    compact: RollMessage,
    natural: number | null
  ): Promise<void> {
    if (full) await this.o.sleep(this.o.suspenseMs);
    await this.inOrder(target, async () => {
      const { client, tidy } = workspace;
      if (full) {
        try {
          this.noteWarnings('reveal', await client.chat.update({ channel: target.channel, ts, ...full }), full.blocks);
        } catch (err) {
          // Never leave the tumbling die up for good: say so in the same message.
          await this.quietly('mark failed reveal', () =>
            client.chat.update({ channel: target.channel, ts, text: REVEAL_FAILED, blocks: compactBlocks(REVEAL_FAILED) })
          );
          throw err;
        }
      }

      const conversation = this.conversation(target);
      const previous = conversation.latest;
      if (previous && previous.ts !== ts && this.updatesInLastMinute(workspace) < SHRINK_BUDGET_PER_MINUTE) {
        this.countUpdate(workspace);
        await this.quietly('shrink previous roll', () =>
          tidy.chat.update({ channel: target.channel, ts: previous.ts, ...previous.compact })
        );
      }
      if (conversation.pickerTs && conversation.pickerTs !== ts) {
        const pickerTs = conversation.pickerTs;
        await this.quietly('remove picker', () => tidy.chat.delete({ channel: target.channel, ts: pickerTs }));
      }
      delete conversation.pickerTs;
      conversation.latest = { ts, compact };
    });

    if (natural === 20 || natural === 1) {
      const name = natural === 20 ? 'tada' : 'skull';
      await this.quietly('crit reaction', () => workspace.tidy.reactions.add({ channel: target.channel, timestamp: ts, name }));
    }
  }

  /** Chains work per conversation so two reveals never interleave. */
  private async inOrder(target: RollTarget, work: () => Promise<void>): Promise<void> {
    const key = conversationKey(target);
    const previous = this.queues.get(key) ?? Promise.resolve();
    const bounded = () => withTimeout(work(), REVEAL_TIMEOUT_MS);
    const next = previous.then(bounded, bounded);
    const settled = next.then(
      () => undefined,
      () => undefined
    );
    this.queues.set(key, settled);
    try {
      await next;
    } finally {
      if (this.queues.get(key) === settled) this.queues.delete(key);
    }
  }

  private conversation(target: RollTarget): Conversation {
    const now = this.o.now();
    for (const [key, c] of this.conversations) {
      if (now - c.touchedAt > FORGET_AFTER_MS) this.conversations.delete(key);
    }
    const key = conversationKey(target);
    const conversation = this.conversations.get(key) ?? { touchedAt: now };
    conversation.touchedAt = now;
    this.conversations.set(key, conversation);
    return conversation;
  }

  private countUpdate(workspace: Workspace): void {
    workspace.updatesAt.push(this.o.now());
  }

  private updatesInLastMinute(workspace: Workspace): number {
    const now = this.o.now();
    workspace.updatesAt = workspace.updatesAt.filter((at) => now - at < 60_000);
    return workspace.updatesAt.length;
  }

  /** Slack's warnings name no call; this names the call and the blocks that drew them. */
  private noteWarnings(what: string, result: unknown, blocks: KnownBlock[]): void {
    const meta = (result as { response_metadata?: { warnings?: string[]; messages?: string[] } } | undefined)
      ?.response_metadata;
    const notes = [...(meta?.warnings ?? []), ...(meta?.messages ?? [])];
    if (notes.length === 0) return;
    const shape = blocks.map((b) => ('accessory' in b && b.accessory ? `${b.type}+${b.accessory.type}` : b.type)).join(',');
    this.o.logger.warn(`[table] ${what} drew warnings: ${notes.join('; ')} (blocks: ${shape})`);
  }

  /** Housekeeping must never break a roll: log and move on. */
  private async quietly(what: string, call: () => Promise<unknown>): Promise<void> {
    try {
      await call();
    } catch (err) {
      this.o.logger.warn(`[table] ${what} failed: ${slackErrorCode(err) ?? String(err)}`);
    }
  }
}

/** Rejects after `ms` so a stuck call cannot block a conversation; the call itself may still finish. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export function conversationKey(target: RollTarget): string {
  return `${target.channel}:${target.threadTs ?? ''}`;
}
