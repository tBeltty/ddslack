// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDiceImages } from '../lib/assets.js';
import { createAppServer } from '../lib/http.js';

const ASSETS = fileURLToPath(new URL('../assets/dice/', import.meta.url));

let close: (() => Promise<void>) | undefined;

afterEach(async () => {
  await close?.();
  close = undefined;
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

async function serve(isReady: () => boolean): Promise<string> {
  const server = createAppServer({ isReady, images: new Map([['d20-17.png', PNG]]) });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  close = () => new Promise((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('GET /healthz', () => {
  it('returns 200 once the Socket Mode connection is open', async () => {
    const base = await serve(() => true);
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });

  it('returns 503 while disconnected', async () => {
    const base = await serve(() => false);
    expect((await fetch(`${base}/healthz`)).status).toBe(503);
  });

  it('answers 404 on any other path', async () => {
    const base = await serve(() => true);
    expect((await fetch(`${base}/`)).status).toBe(404);
  });

  it('marks errors as not cacheable, so the CDN never keeps a 404 or a 503', async () => {
    const base = await serve(() => false);
    expect((await fetch(`${base}/dice/v2/nope.png`)).headers.get('cache-control')).toBe('no-store');
    expect((await fetch(`${base}/healthz`)).headers.get('cache-control')).toBe('no-store');
  });
});

describe('die face images', () => {
  it('serves a known face as a cacheable PNG', async () => {
    const base = await serve(() => true);
    const res = await fetch(`${base}/dice/v2/d20-17.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PNG);
  });

  it.each([
    '/dice/v2/d20-21.png',
    '/dice/v2/../../../etc/passwd',
    '/dice/v2/%2e%2e%2fpackage.json',
    '/dice/v2/d20-17.png?x=1',
    '/dice/v3/d20-17.png',
  ])('returns 404 for %s', async (path) => {
    const base = await serve(() => true);
    expect((await fetch(`${base}${path}`)).status).toBe(404);
  });

  it('composes strips from the stored faces and rejects unknown ones', async () => {
    const server = createAppServer({ isReady: () => true, images: loadDiceImages(ASSETS) });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    close = () => new Promise((resolve) => server.close(() => resolve()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ok = await fetch(`${base}/dice/v2/strip/d6-3_d6-5.png`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
    expect((await fetch(`${base}/dice/v2/strip/d6-9_d6-5.png`)).status).toBe(404);
  });

  it('still answers the previous version, so images in older messages keep loading', async () => {
    const base = await serve(() => true);
    expect((await fetch(`${base}/dice/v1/d20-17.png`)).status).toBe(200);
  });

  it('rejects methods other than GET and HEAD', async () => {
    const base = await serve(() => true);
    expect((await fetch(`${base}/dice/v2/d20-17.png`, { method: 'POST' })).status).toBe(405);
  });
});
