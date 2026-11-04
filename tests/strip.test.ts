// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { loadDiceImages, parseStripName, stripImageName } from '../lib/assets.js';
import { StripComposer } from '../lib/strip.js';

const images = loadDiceImages(fileURLToPath(new URL('../assets/dice/', import.meta.url)));

describe('strip names', () => {
  it('names up to three faces and counts the rest', () => {
    const d6 = (value: number) => ({ sides: 6, value });
    expect(stripImageName([d6(3), d6(5)])).toBe('strip/d6-3_d6-5.png');
    expect(stripImageName([d6(1), d6(2), d6(3), d6(4), d6(5)])).toBe('strip/d6-1_d6-2_d6-3_m2.png');
    expect(stripImageName([{ sides: 20, value: 4, dropped: true }, { sides: 20, value: 15 }])).toBe(
      'strip/d20-4x_d20-15.png'
    );
  });

  it('reads valid names back into stored images', () => {
    expect(parseStripName('strip/d20-4x_d20-15.png', images)).toEqual({
      faces: [
        { image: 'd20-4.png', dropped: true },
        { image: 'd20-15.png', dropped: false },
      ],
    });
    expect(parseStripName('strip/d6-1_d6-2_d6-3_m97.png', images)?.badge).toBe('more-97.png');
  });

  it.each([
    'strip/d6-3.png',
    'strip/d6-1_d6-2_d6-3_d6-4.png',
    'strip/d6-7_d6-1.png',
    'strip/d7-1_d7-2.png',
    'strip/d6-1_d6-2_m5.png',
    'strip/d6-1_d6-2_d6-3_m98.png',
    'strip/d6-1_d6-2_d6-3_m0.png',
    'strip/../d6-1_d6-2.png',
    'strip/d6-1_d6-2.png?x=1',
    'strip/d6-1_d6-2.gif',
  ])('rejects %s', (name) => {
    expect(parseStripName(name, images)).toBeNull();
  });
});

describe('StripComposer', () => {
  it('lays out three faces and a badge side by side', () => {
    const png = PNG.sync.read(new StripComposer(images).get('strip/d6-1_d6-2_d6-3_m5.png') as Buffer);
    expect(png.width).toBe(160 * 3 + 96);
    expect(png.height).toBe(160);
  });

  it('fades dropped dice', () => {
    const composer = new StripComposer(images);
    const alphaAtCenter = (name: string) => {
      const png = PNG.sync.read(composer.get(name) as Buffer);
      return png.data[(80 * png.width + 80) * 4 + 3] ?? 0;
    };
    expect(alphaAtCenter('strip/d20-4_d20-15.png')).toBe(255);
    expect(alphaAtCenter('strip/d20-4x_d20-15.png')).toBeLessThan(100);
  });

  it('composes each strip once and returns null for invalid names', () => {
    const composer = new StripComposer(images);
    const first = composer.get('strip/d8-2_d8-7.png');
    expect(composer.get('strip/d8-2_d8-7.png')).toBe(first);
    expect(composer.get('strip/d8-9_d8-7.png')).toBeNull();
  });
});
