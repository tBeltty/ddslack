// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { diceImageUrl, loadDiceImages } from '../lib/assets.js';
import { STANDARD_DICE } from '../lib/dice.js';

const ASSETS = fileURLToPath(new URL('../assets/dice/', import.meta.url));

describe('die face images', () => {
  const images = loadDiceImages(ASSETS);
  const faces = [...images].filter(([name]) => /^d\d+-\d+\.png$/.test(name));

  it('has one light PNG for every face of every standard die', () => {
    expect(faces.length).toBe(STANDARD_DICE.reduce((sum, sides) => sum + sides, 0));
    for (const [name, png] of faces) {
      expect(png.subarray(1, 4).toString(), name).toBe('PNG');
      expect(png.length, name).toBeLessThan(8 * 1024);
    }
  });

  it('shares one canvas size across every face', () => {
    const sizes = new Set(faces.map(([, png]) => `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`));
    expect([...sizes]).toEqual(['160x160']);
  });

  it('has a light looping GIF per die on the same canvas', () => {
    for (const sides of STANDARD_DICE) {
      const gif = images.get(`d${sides}-rolling.gif`);
      expect(gif?.subarray(0, 6).toString()).toBe('GIF89a');
      expect(gif && `${gif.readUInt16LE(6)}x${gif.readUInt16LE(8)}`).toBe('160x160');
      expect(gif?.length ?? Infinity).toBeLessThan(80 * 1024);
    }
  });

  it('has strips of two and three tumbling dice, sized for a row', () => {
    for (const sides of STANDARD_DICE) {
      for (const count of [2, 3]) {
        const gif = images.get(`d${sides}-rolling-${count}.gif`);
        expect(gif?.subarray(0, 6).toString()).toBe('GIF89a');
        expect(gif && `${gif.readUInt16LE(6)}x${gif.readUInt16LE(8)}`).toBe(`${120 * count}x120`);
        expect(gif?.length ?? Infinity).toBeLessThan(100 * 1024);
      }
    }
  });

  it('has a light "+N" badge for every count past three dice', () => {
    for (let extra = 1; extra <= 97; extra++) {
      const png = images.get(`more-${extra}.png`);
      expect(png && `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe('96x160');
      expect(png?.length ?? Infinity).toBeLessThan(2 * 1024);
    }
  });

  it('has the larger natural 20 and natural 1 images', () => {
    for (const value of [20, 1]) {
      const png = images.get(`d20-${value}-large.png`);
      expect(png && `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe('320x320');
    }
  });

  it('fails loudly when a face is missing', () => {
    expect(() =>
      loadDiceImages(ASSETS, (path) => {
        if (path.endsWith('d12-7.png')) throw new Error('missing');
        return readFileSync(path);
      })
    ).toThrow();
  });

  it('builds versioned public URLs', () => {
    expect(diceImageUrl('https://ddslack.tbelt.online/', 20, 17)).toBe(
      'https://ddslack.tbelt.online/dice/v2/d20-17.png'
    );
    expect(existsSync(`${ASSETS}d20-17.png`)).toBe(true);
  });
});
