import type { ChangeType, KudosFace, RoundMods } from './data';

export interface Change {
  id: number;
  type: ChangeType;
  value: number;
}

/** A change sitting on the Deployment Pipeline this round. */
export interface DeployedChange extends Change {
  /** Spaces it actually moved the marker. */
  moved: number;
  /** Bug points it actually added (0 for non-Bugs, or a "Works On My Machine" Bug). */
  bugPoints: number;
}

export type PlayerStatus = 'waiting' | 'deploying' | 'shipped' | 'down';

export interface PlayerStats {
  outages: number;
  biggestDeploy: number;
  maxCoffee: number;
  coffeeEarned: number;
  /** Highest Bug total a player successfully shipped with. */
  riskiestShip: number;
  ships: number;
  kudos: number;
}

export interface RoundSummary {
  space: number;
  status: PlayerStatus;
  lines: string[];
  budget: number;
  up: number;
  coffee: number;
}

export interface Player {
  seat: number;
  name: string;
  avatar: string;
  /** null for humans. */
  bot: null | 'vendor' | 'dev';
  /** Hash of the seat token. The raw token never leaves the phone except in actions. */
  key: string;
  connected: boolean;

  /** Everything the player owns. */
  backlog: Change[];
  /** What is left to draw this round. */
  pile: Change[];
  deployed: DeployedChange[];

  startPos: number;
  headStart: number;
  position: number;
  bugTotal: number;
  status: PlayerStatus;
  draws: number;
  bug3s: number;
  firstBugSeen: boolean;

  rollbackCharged: boolean;
  pendingLogReview: Change[] | null;
  pendingScoreChoice: boolean;
  purchases: ChangeType[];
  vendorDone: boolean;

  budget: number;
  up: number;
  coffee: number;

  summary: RoundSummary | null;
  stats: PlayerStats;
}

export type Phase = 'lobby' | 'cab' | 'deploying' | 'review' | 'vendor' | 'final';

export interface Settings {
  /** Seconds, 0 = no timer. */
  deployTimer: number;
  legacyVendor: boolean;
  sound: boolean;
}

export interface GameEvent {
  id: number;
  kind:
    | 'join'
    | 'draw'
    | 'bug'
    | 'ship'
    | 'down'
    | 'rollback'
    | 'unittest'
    | 'kudos'
    | 'cab'
    | 'buy'
    | 'info'
    | 'final';
  seat: number | null;
  text: string;
}

export interface KudosRoll {
  seat: number;
  face: KudosFace;
}

export interface Game {
  seed: number;
  rng: number;
  round: number;
  phase: Phase;
  players: Player[];
  settings: Settings;
  cabDeck: string[];
  cab: string | null;
  mods: RoundMods;
  deployDeadline: number | null;
  kudos: KudosRoll[];
  events: GameEvent[];
  eventSeq: number;
  nextChangeId: number;
}

export type Action =
  | { type: 'join'; key: string; name: string; avatar: string }
  | { type: 'setConnected'; key: string; connected: boolean }
  | { type: 'addBot'; bot: 'dev' | 'vendor' }
  | { type: 'removePlayer'; seat: number }
  | { type: 'settings'; settings: Partial<Settings> }
  | { type: 'start'; seed?: number }
  | { type: 'beginDeploy'; now: number }
  | { type: 'draw'; seat: number }
  | { type: 'ship'; seat: number }
  | { type: 'rollback'; seat: number }
  | { type: 'logReviewPick'; seat: number; index: number | null }
  | { type: 'timeout' }
  | { type: 'chooseScore'; seat: number; pick: 'budget' | 'up' }
  | { type: 'toVendor' }
  | { type: 'buy'; seat: number; changeType: ChangeType; value: number }
  | { type: 'recharge'; seat: number }
  | { type: 'improve'; seat: number }
  | { type: 'vendorDone'; seat: number };

export class RuleError extends Error {}
