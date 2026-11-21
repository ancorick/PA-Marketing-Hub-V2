import { createHash } from 'node:crypto';

/**
 * Stable UUID for a demo row: the same kind and number always give the same ID, so a re-seed produces
 * identical data and references between tables never depend on insertion order.
 */
export function demoId(kind: string, n: number | string): string {
  const hex = createHash('sha256').update(`marketing-hub-demo:${kind}:${n}`).digest('hex');
  const variant = (8 + (Number.parseInt(hex[16] as string, 16) & 3)).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Seeded pseudo-random numbers (mulberry32). Each part of the data set uses its own stream, named after the
 * part, so changing one part never shifts the numbers of another.
 */
export class Random {
  private state: number;

  constructor(seed: string) {
    this.state = createHash('sha256').update(seed).digest().readUInt32BE(0) || 1;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)] as T;
  }

  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = this.next() * total;
    for (const [item, weight] of items) {
      roll -= weight;
      if (roll < 0) return item;
    }
    return (items[items.length - 1] as readonly [T, number])[0];
  }
}
