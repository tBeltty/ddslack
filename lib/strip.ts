import { PNG } from 'pngjs';
import { parseStripName } from './assets.js';

const DROPPED_ALPHA = 0.35;
const CACHE_LIMIT = 256;

/**
 * Builds strip images (a roll's faces side by side, then a "+N" badge) from the stored PNGs.
 * Decoded sources and finished strips are kept in memory, so a strip is composed once.
 */
export class StripComposer {
  private readonly decoded = new Map<string, PNG>();
  private readonly strips = new Map<string, Buffer>();

  constructor(private readonly images: Map<string, Buffer>) {}

  has(name: string): boolean {
    return this.strips.has(name);
  }

  /** Whether a name lists known faces, checked before spending any composition budget on it. */
  isValid(name: string): boolean {
    return parseStripName(name, this.images) !== null;
  }

  /** The PNG for a strip name, or null when the name is not a valid strip. */
  get(name: string): Buffer | null {
    const cached = this.strips.get(name);
    if (cached) {
      this.strips.delete(name);
      this.strips.set(name, cached);
      return cached;
    }
    const parsed = parseStripName(name, this.images);
    if (!parsed) return null;

    const parts = [
      ...parsed.faces.map((face) => ({ png: this.decode(face.image), alpha: face.dropped ? DROPPED_ALPHA : 1 })),
      ...(parsed.badge ? [{ png: this.decode(parsed.badge), alpha: 1 }] : []),
    ];
    const strip = new PNG({
      width: parts.reduce((sum, part) => sum + part.png.width, 0),
      height: Math.max(...parts.map((part) => part.png.height)),
    });
    let x = 0;
    for (const { png, alpha } of parts) {
      const top = Math.floor((strip.height - png.height) / 2);
      for (let row = 0; row < png.height; row++) {
        for (let col = 0; col < png.width; col++) {
          const from = (row * png.width + col) * 4;
          const to = ((top + row) * strip.width + x + col) * 4;
          strip.data[to] = png.data[from] ?? 0;
          strip.data[to + 1] = png.data[from + 1] ?? 0;
          strip.data[to + 2] = png.data[from + 2] ?? 0;
          strip.data[to + 3] = Math.round((png.data[from + 3] ?? 0) * alpha);
        }
      }
      x += png.width;
    }

    const buffer = PNG.sync.write(strip);
    this.strips.set(name, buffer);
    if (this.strips.size > CACHE_LIMIT) {
      const oldest = this.strips.keys().next().value;
      if (oldest !== undefined) this.strips.delete(oldest);
    }
    return buffer;
  }

  private decode(image: string): PNG {
    let png = this.decoded.get(image);
    if (!png) {
      png = PNG.sync.read(this.images.get(image) as Buffer);
      this.decoded.set(image, png);
    }
    return png;
  }
}
