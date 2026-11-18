/**
 * Wire protocol between the HOST (authoritative) and PHONES (thin controllers).
 *
 *  phone → host  event "action": { token, msg: PhoneMsg }
 *  host  → all   event "state":  StateMsg (public state + private state keyed by hashed token)
 *  host  → all   event "error":  { key, message }
 *  host  → all   event "closed": {}  (host tab closed; the room code is dead)
 */
import type { ChangeType } from '../engine/data';
import type { Change, Game } from '../engine/types';

export const ROOM_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O

export function makeRoomCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += ROOM_LETTERS[Math.floor(rand() * ROOM_LETTERS.length)];
  return s;
}

export function normalizeRoomCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 4);
}

export function isRoomCode(s: string): boolean {
  return s.length === 4 && [...s].every((c) => ROOM_LETTERS.includes(c));
}

export type PhoneMsg =
  | { type: 'hello' }
  | { type: 'join'; name: string; avatar: string }
  | { type: 'draw'; expectDraws?: number }
  | { type: 'ship' }
  | { type: 'rollback' }
  | { type: 'logReviewPick'; index: number | null }
  | { type: 'chooseScore'; pick: 'budget' | 'up' }
  | { type: 'buy'; changeType: ChangeType; value: number }
  | { type: 'recharge' }
  | { type: 'improve' }
  | { type: 'vendorDone' };

export interface ActionEnvelope {
  token: string;
  msg: PhoneMsg;
}

/** Public projection of the game: no RNG state, no future CAB cards, no hidden peeks. */
export type PublicGame = Omit<Game, 'rng' | 'cabDeck'> & { rng: 0; cabDeck: [] };

export interface PrivateState {
  logReview: Change[] | null;
}

export interface StateMsg {
  v: number;
  room: string;
  now: number;
  game: PublicGame;
  private: Record<string, PrivateState>;
}

export interface ErrorMsg {
  key: string;
  message: string;
}

export function projectGame(g: Game): { game: PublicGame; priv: Record<string, PrivateState> } {
  const priv: Record<string, PrivateState> = {};
  const players = g.players.map((p) => {
    priv[p.key] = { logReview: p.pendingLogReview };
    return { ...p, pendingLogReview: p.pendingLogReview ? [] : null };
  });
  return {
    game: { ...g, players, rng: 0, cabDeck: [], events: g.events.slice(-12) },
    priv,
  };
}
