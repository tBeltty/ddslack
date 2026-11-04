// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { createServer, type Server } from 'node:http';
import { DICE_IMAGE_PREFIX, LEGACY_IMAGE_PREFIXES, readStripPath } from './assets.js';
import { INSTALL_PATH, type InstallRoutes, REDIRECT_PATH } from './install.js';
import { StripComposer } from './strip.js';

const CONTENT_TYPES: Record<string, string> = { png: 'image/png', gif: 'image/gif' };
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Allows `rate` events per second with bursts up to `burst`. New strips go through one, so old
 * messages keep their images while nobody can keep the CPU busy composing new ones.
 */
export class TokenBucket {
  private tokens: number;
  private at: number;

  constructor(
    private readonly rate: number,
    private readonly burst: number,
    private readonly now: () => number = Date.now
  ) {
    this.tokens = burst;
    this.at = now();
  }

  take(): boolean {
    const now = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) / 1000) * this.rate);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/**
 * Serves `GET /healthz` (200 while `isReady()` holds, 503 otherwise) and the die images from
 * memory: stored images by exact name, and strips composed from them. Anything else is 404.
 */
export function createAppServer(o: {
  isReady: () => boolean;
  images: Map<string, Buffer>;
  unsignedStrips?: TokenBucket;
  signedStrips?: TokenBucket;
  /** Serves the install link and Slack's OAuth redirect when the app is distributed. */
  installer?: InstallRoutes;
  logError?: (message: string) => void;
}): Server {
  const strips = new StripComposer(o.images);
  const unsigned = o.unsignedStrips ?? new TokenBucket(2, 10);
  // Signed names come from real rolls, but a member could collect many and replay them.
  const signed = o.signedStrips ?? new TokenBucket(10, 50);
  return createServer((req, res) => {
    // Errors must never be cached by the CDN, or a URL requested too early stays broken for hours.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, NO_STORE);
      res.end();
      return;
    }

    const path = req.url?.split('?')[0];
    if (o.installer && req.method === 'GET' && (path === INSTALL_PATH || path === REDIRECT_PATH)) {
      const installer = o.installer;
      // Install links and redirects carry one-time state; no cache may keep them.
      res.setHeader('Cache-Control', 'no-store');
      const handle = path === INSTALL_PATH ? installer.handleInstallPath(req, res) : installer.handleCallback(req, res);
      handle.catch((err: unknown) => {
        o.logError?.(`[install] ${path} failed: ${String(err)}`);
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain', ...NO_STORE });
        res.end();
      });
      return;
    }

    if (req.url === '/healthz') {
      const ready = o.isReady();
      res.writeHead(ready ? 200 : 503, { 'Content-Type': 'text/plain', ...NO_STORE });
      res.end(ready ? 'ok' : 'not ready');
      return;
    }

    const prefix = [DICE_IMAGE_PREFIX, ...LEGACY_IMAGE_PREFIXES].find((p) => req.url?.startsWith(p));
    const name = prefix && req.url ? req.url.slice(prefix.length) : '';
    let image: Buffer | null | undefined;
    if (name.startsWith('strip/')) {
      const strip = readStripPath(name);
      const fresh = strip && !strips.has(strip.name) && strips.isValid(strip.name);
      if (strip && fresh && !(strip.signed ? signed : unsigned).take()) {
        res.writeHead(503, { 'Retry-After': '5', ...NO_STORE });
        res.end();
        return;
      }
      image = strip ? strips.get(strip.name) : null;
    } else {
      image = o.images.get(name);
    }
    const contentType = CONTENT_TYPES[name.split('.').pop() ?? ''];
    if (image && contentType) {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': image.length,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : image);
      return;
    }

    res.writeHead(404, NO_STORE);
    res.end();
  });
}
