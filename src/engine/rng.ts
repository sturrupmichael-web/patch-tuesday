/**
 * Seeded RNG (mulberry32). The generator state is a single uint32 stored in
 * the game state, so every draw is reproducible from the starting seed.
 */
export function nextRandom(state: number): [value: number, next: number] {
  let t = (state + 0x6d2b79f5) >>> 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, next];
}

/** Mutable wrapper used inside a single (pure-from-outside) reducer call. */
export class Rng {
  constructor(public state: number) {}
  next(): number {
    const [v, n] = nextRandom(this.state);
    this.state = n;
    return v;
  }
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/** Seed from a string (e.g. "debug-42") or number. */
export function seedFrom(input: string | number): number {
  if (typeof input === 'number') return input >>> 0;
  return hashString(input);
}

/** FNV-1a 32-bit. Also used to hash seat tokens. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Hash a secret seat token into a public key (never broadcast raw tokens). */
export function tokenKey(token: string): string {
  return hashString('pt1:' + token).toString(36) + hashString('pt2:' + token + ':x').toString(36);
}
