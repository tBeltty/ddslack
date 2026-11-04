// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STANDARD_DICE } from './dice.js';

/**
 * Versioned so a redesign gets new URLs: the images are cached as immutable by the CDN and by
 * Slack, so changing a file under the same URL would keep showing the old one. Bump this
 * whenever scripts/render-dice.py changes the output.
 */
export const DICE_IMAGE_PREFIX = '/dice/v2/';

/** Older prefixes still answer, so images in messages posted before a bump keep loading. */
export const LEGACY_IMAGE_PREFIXES = ['/dice/v1/'];

export function diceImageName(sides: number, value: number): string {
  return `d${sides}-${value}.png`;
}

/** Rolls show at most this many dice as images; a badge counts the rest. */
export const MAX_VISIBLE_DICE = 3;
const MAX_EXTRA_DICE = 100 - MAX_VISIBLE_DICE;

/** Looping animation shown while a roll is being revealed: one die, or a strip of two or three. */
export function rollingImageName(sides: number, count = 1): string {
  const visible = Math.min(Math.max(count, 1), MAX_VISIBLE_DICE);
  return visible === 1 ? `d${sides}-rolling.gif` : `d${sides}-rolling-${visible}.gif`;
}

/** The "+N" badge for dice beyond the visible ones. */
export function badgeImageName(extra: number): string {
  return `more-${extra}.png`;
}

export interface StripDie {
  sides: number;
  value: number;
  /** Dropped dice (the lower one with advantage) are shown faded. */
  dropped?: boolean;
}

let stripKey: Buffer | null = null;

/**
 * Turns on signed strip URLs. Billions of strip names are valid, so without a tag anyone could
 * make the app compose a new image per request; with it, only names this app wrote are composed.
 */
export function setStripKey(secret: string | null): void {
  stripKey = secret ? createHmac('sha256', secret).update('ddslack dice strip').digest() : null;
}

function stripTag(body: string): string {
  return createHmac('sha256', stripKey as Buffer)
    .update(body)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Name of the composed image of a roll: up to three faces, then a badge for the rest, signed
 * when a key is set. Example: `strip/<tag>/d20-15_d20-4x.png`, or `strip/<tag>/d6-3_d6-5_d6-1_m5.png` for 8d6.
 */
export function stripImageName(dice: StripDie[]): string {
  const slots = dice.slice(0, MAX_VISIBLE_DICE).map((d) => `d${d.sides}-${d.value}${d.dropped ? 'x' : ''}`);
  const extra = dice.length - MAX_VISIBLE_DICE;
  const body = `${slots.join('_')}${extra > 0 ? `_m${extra}` : ''}`;
  return stripKey ? `strip/${stripTag(body)}/${body}.png` : `strip/${body}.png`;
}

const SIGNED_STRIP = /^strip\/([0-9a-f]{16})\/([^/]+)$/;

/**
 * Splits a requested strip path into the unsigned name the composer caches, and whether its tag
 * checked out. Unsigned names come from messages posted before signing; a wrong tag is null.
 */
export function readStripPath(path: string): { name: string; signed: boolean } | null {
  const signed = SIGNED_STRIP.exec(path);
  if (!signed) return path.startsWith('strip/') && !path.slice(6).includes('/') ? { name: path, signed: false } : null;
  const [, tag = '', file = ''] = signed;
  const body = file.replace(/\.png$/, '');
  if (!stripKey || !timingSafeEqual(Buffer.from(tag), Buffer.from(stripTag(body)))) return null;
  return { name: `strip/${file}`, signed: true };
}

const STRIP_NAME = /^strip\/(d\d{1,3}-\d{1,3}x?(?:_d\d{1,3}-\d{1,3}x?){1,2})(?:_m(\d{1,2}))?\.png$/;

/**
 * Reads a strip name back into the images it is made of. Returns null unless every part names
 * a known face (and a known badge), so the URL can never point at anything else.
 */
export function parseStripName(
  name: string,
  images: Map<string, Buffer>
): { faces: Array<{ image: string; dropped: boolean }>; badge?: string } | null {
  const match = STRIP_NAME.exec(name);
  if (!match?.[1]) return null;
  const faces = match[1].split('_').map((slot) => {
    const dropped = slot.endsWith('x');
    return { image: `${dropped ? slot.slice(0, -1) : slot}.png`, dropped };
  });
  if (!faces.every((face) => images.has(face.image))) return null;
  if (match[2] === undefined) return { faces };
  const extra = Number(match[2]);
  if (faces.length !== MAX_VISIBLE_DICE || extra < 1 || extra > MAX_EXTRA_DICE) return null;
  const badge = badgeImageName(extra);
  return images.has(badge) ? { faces, badge } : null;
}

/** Larger face for the natural 20 and natural 1 celebrations. */
export function critImageName(value: 1 | 20): string {
  return `d20-${value}-large.png`;
}

export function imageUrl(baseUrl: string, name: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${DICE_IMAGE_PREFIX}${name}`;
}

export function diceImageUrl(baseUrl: string, sides: number, value: number): string {
  return imageUrl(baseUrl, diceImageName(sides, value));
}

/** Every stored image: each face, the rolling GIFs, the two crit images and the badges. */
export function allImageNames(): string[] {
  const names: string[] = [];
  for (const sides of STANDARD_DICE) {
    for (let value = 1; value <= sides; value++) names.push(diceImageName(sides, value));
    for (let count = 1; count <= MAX_VISIBLE_DICE; count++) names.push(rollingImageName(sides, count));
  }
  names.push(critImageName(20), critImageName(1));
  for (let extra = 1; extra <= MAX_EXTRA_DICE; extra++) names.push(badgeImageName(extra));
  return names;
}

/** Loads every image into memory; throws if one is missing so a broken build never starts. */
export function loadDiceImages(dir: string, read: (path: string) => Buffer = readFileSync): Map<string, Buffer> {
  return new Map(allImageNames().map((name) => [name, read(join(dir, name))]));
}
