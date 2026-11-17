/**
 * PATCH TUESDAY rules engine.
 *
 * Pure: `reduce(game, action)` returns a NEW game (the input is never mutated)
 * or throws a RuleError. All randomness comes from the seeded RNG state stored
 * in the game, so a game can be replayed from its seed + action log.
 */
import {
  AVATARS,
  BUDGET_PER_UP,
  CAB_NOTICES,
  CHANGES,
  COFFEE_PER_UP,
  DEFAULT_MODS,
  KUDOS_DIE,
  LAST_SPACE,
  MAX_PURCHASES,
  MAX_SEATS,
  MAX_START_POS,
  PIPELINE,
  PROCESS_IMPROVEMENT_COST,
  RELIEF_ICONS,
  ROLLBACK_RECHARGE_COST,
  ROUNDS,
  STARTING_BACKLOG,
  kudosLabel,
  type ChangeType,
  type CabNotice,
  type KudosFace,
} from './data';
import { Rng } from './rng';
import {
  RuleError,
  type Action,
  type Change,
  type Game,
  type GameEvent,
  type Player,
  type Settings,
} from './types';

export const DEFAULT_SETTINGS: Settings = { deployTimer: 90, legacyVendor: true, sound: true };

export function createGame(seed: number, settings: Partial<Settings> = {}): Game {
  return {
    seed,
    rng: seed >>> 0,
    round: 0,
    phase: 'lobby',
    players: [],
    settings: { ...DEFAULT_SETTINGS, ...settings },
    cabDeck: [],
    cab: null,
    mods: { ...DEFAULT_MODS },
    deployDeadline: null,
    kudos: [],
    events: [],
    eventSeq: 0,
    nextChangeId: 1,
  };
}

export function cabById(id: string | null): CabNotice | null {
  return CAB_NOTICES.find((c) => c.id === id) ?? null;
}

export function humans(g: Game): Player[] {
  return g.players.filter((p) => !p.bot);
}

// ---------------------------------------------------------------------------
// Internal helpers (operate on the cloned game)
// ---------------------------------------------------------------------------

function ev(g: Game, kind: GameEvent['kind'], seat: number | null, text: string) {
  g.events.push({ id: ++g.eventSeq, kind, seat, text });
  if (g.events.length > 40) g.events.splice(0, g.events.length - 40);
}

function newChange(g: Game, type: ChangeType, value: number): Change {
  return { id: g.nextChangeId++, type, value };
}

function getPlayer(g: Game, seat: number): Player {
  const p = g.players.find((x) => x.seat === seat);
  if (!p) throw new RuleError('No such seat');
  return p;
}

function addCoffee(p: Player, n: number) {
  p.coffee += n;
  p.stats.coffeeEarned += n;
  p.stats.maxCoffee = Math.max(p.stats.maxCoffee, p.coffee);
}

function newPlayer(g: Game, seat: number, name: string, avatar: string, key: string, bot: Player['bot']): Player {
  return {
    seat,
    name,
    avatar,
    bot,
    key,
    connected: true,
    backlog: STARTING_BACKLOG.map((c) => newChange(g, c.type, c.value)),
    pile: [],
    deployed: [],
    startPos: 0,
    headStart: 0,
    position: 0,
    bugTotal: 0,
    status: 'waiting',
    draws: 0,
    bug3s: 0,
    firstBugSeen: false,
    rollbackCharged: true,
    pendingLogReview: null,
    pendingScoreChoice: false,
    purchases: [],
    vendorDone: false,
    budget: 0,
    up: 0,
    coffee: 0,
    summary: null,
    stats: { outages: 0, biggestDeploy: 0, maxCoffee: 0, coffeeEarned: 0, riskiestShip: -1, ships: 0, kudos: 0 },
  };
}

function nextSeat(g: Game): number {
  for (let s = 0; s < 16; s++) if (!g.players.some((p) => p.seat === s)) return s;
  throw new RuleError('Room is full');
}

function cleanName(name: string): string {
  const n = (name ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
  return n || 'Anonymous';
}

/** Number of Tech Debt Relief icons strictly above `up` and at or below `leaderUp`. */
export function reliefIcons(up: number, leaderUp: number): number {
  return RELIEF_ICONS.filter((p) => p > up && p <= leaderUp).length;
}

/** Price of a change in the Vendor Portal this round (null = not for sale). */
export function priceOf(g: Game, type: ChangeType, value: number): number | null {
  const def = CHANGES[type];
  const base = def.prices[value];
  if (base === undefined) return null;
  return Math.max(1, base - g.mods.priceDiscount);
}

export function isUnlocked(g: Game, type: ChangeType): boolean {
  return CHANGES[type].unlockRound <= g.round;
}

/** Vendor Portal validation, shared by the phone (UX) and the host (authority). */
export function validateBuy(g: Game, seat: number, type: ChangeType, value: number): string | null {
  if (g.phase !== 'vendor') return 'The Vendor Portal is closed';
  const p = g.players.find((x) => x.seat === seat);
  if (!p) return 'No such seat';
  if (p.vendorDone) return 'You already closed the Vendor Portal';
  if (!isUnlocked(g, type)) return `${CHANGES[type].name} is not available yet`;
  const price = priceOf(g, type, value);
  if (price === null) return 'That change is not sold at that size';
  if (p.purchases.length >= MAX_PURCHASES) return `You can buy at most ${MAX_PURCHASES} changes per round`;
  if (p.purchases.includes(type)) return 'Your two purchases must be different types';
  if (price > p.budget) return 'Not enough Budget';
  return null;
}

export interface ShopItem {
  type: ChangeType;
  value: number;
  price: number;
}

export function shopItems(g: Game): ShopItem[] {
  const out: ShopItem[] = [];
  for (const def of Object.values(CHANGES)) {
    if (!isUnlocked(g, def.type)) continue;
    for (const v of Object.keys(def.prices).map(Number)) {
      out.push({ type: def.type, value: v, price: priceOf(g, def.type, v)! });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Round flow
// ---------------------------------------------------------------------------

function startRound(g: Game, rng: Rng) {
  g.round += 1;
  g.phase = 'cab';
  g.kudos = [];
  g.deployDeadline = null;
  const cabId = g.cabDeck.shift() ?? null;
  g.cab = cabId;
  const cab = cabById(cabId);
  g.mods = { ...DEFAULT_MODS, ...(cab?.mods ?? {}) };
  for (const p of g.players) {
    p.pile = p.backlog.map((c) => ({ ...c }));
    p.deployed = [];
    p.bugTotal = 0;
    p.status = 'waiting';
    p.draws = 0;
    p.bug3s = 0;
    p.firstBugSeen = false;
    p.pendingLogReview = null;
    p.pendingScoreChoice = false;
    p.purchases = [];
    p.vendorDone = false;
    p.summary = null;
    p.budget = 0; // Budget is use-it-or-lose-it: unspent money is lost at the next window.
  }
  if (cab) {
    ev(g, 'cab', null, `CAB NOTICE: ${cab.title}`);
    applyInstant(g, cab);
  }
  // Tech Debt Relief: head start for players behind the leader.
  const leaderUp = Math.max(...g.players.map((p) => p.up));
  for (const p of g.players) {
    p.headStart = reliefIcons(p.up, leaderUp) * g.mods.reliefMultiplier;
    p.position = Math.min(LAST_SPACE, p.startPos + p.headStart + g.mods.startBonus);
  }
  void rng;
}

function applyInstant(g: Game, cab: CabNotice) {
  switch (cab.instant) {
    case 'coffeeAll':
      g.players.forEach((p) => addCoffee(p, 1));
      break;
    case 'coffeeLast': {
      const low = Math.min(...g.players.map((p) => p.up));
      g.players.filter((p) => p.up === low).forEach((p) => addCoffee(p, 1));
      break;
    }
    case 'scriptAll':
      g.players.forEach((p) => p.backlog.push(newChange(g, 'script', 1)));
      break;
    case 'rechargeAll':
      g.players.forEach((p) => (p.rollbackCharged = true));
      break;
  }
}

function drawRandom(p: Player, rng: Rng): Change {
  const i = rng.int(p.pile.length);
  return p.pile.splice(i, 1)[0];
}

function ship(g: Game, p: Player, reason = 'SHIPPED IT ✅') {
  returnLogReview(p);
  p.status = 'shipped';
  p.stats.ships += 1;
  p.stats.riskiestShip = Math.max(p.stats.riskiestShip, p.bugTotal);
  ev(g, 'ship', p.seat, `${p.name} ${reason}`);
}

function returnLogReview(p: Player) {
  if (p.pendingLogReview) {
    p.pile.push(...p.pendingLogReview);
    p.pendingLogReview = null;
  }
}

/** Put a change on the pipeline and resolve its immediate effect. */
function placeChange(g: Game, p: Player, chip: Change, rng: Rng) {
  const m = g.mods;
  let move = chip.value;
  let bugPoints = 0;

  if (chip.type === 'bug') {
    bugPoints = chip.value;
    if (m.firstBugFree && !p.firstBugSeen) bugPoints = 0;
    p.firstBugSeen = true;
  }
  if (chip.type === 'automation') {
    const scripts = p.deployed.filter((d) => d.type === 'script').length;
    move += Math.min(2, scripts);
  }
  if (chip.type === 'script') move += m.scriptBonus;
  if (chip.type === 'unittest') {
    const prev = p.deployed[p.deployed.length - 1];
    if (prev && prev.type === 'bug') {
      p.deployed.pop();
      p.position -= prev.moved;
      p.bugTotal -= prev.bugPoints;
      if (prev.value === 3) p.bug3s -= 1;
      p.pile.push({ id: prev.id, type: prev.type, value: prev.value });
      ev(g, 'unittest', p.seat, `${p.name}'s Unit Test caught a Bug ${prev.value}`);
    }
  }
  if (m.firstChangeDouble && p.draws === 0) move *= 2;

  p.position += move;
  p.bugTotal += bugPoints;
  p.draws += 1;
  p.deployed.push({ ...chip, moved: move, bugPoints });
  p.stats.biggestDeploy = Math.max(p.stats.biggestDeploy, Math.min(p.position, LAST_SPACE));

  const def = CHANGES[chip.type];
  ev(g, chip.type === 'bug' ? 'bug' : 'draw', p.seat, `${p.name} deployed ${def.name} ${chip.value}`);

  if (chip.type === 'bug' && chip.value === 3) p.bug3s += 1;
  if (m.freezeOn3s && chip.type === 'bug' && chip.value === 3 && p.bug3s >= 2) {
    ship(g, p, 'was auto-shipped by the Change Freeze ❄️');
    return;
  }
  if (p.bugTotal > m.bugLimit) {
    p.status = 'down';
    p.stats.outages += 1;
    returnLogReview(p);
    ev(g, 'down', p.seat, `PROD DOWN 🔥 — ${p.name}`);
    return;
  }
  if (chip.type === 'logreview' && p.pile.length > 0) {
    const n = Math.min(chip.value, p.pile.length);
    p.pendingLogReview = Array.from({ length: n }, () => drawRandom(p, rng));
    return;
  }
  if (p.pile.length === 0) ship(g, p, 'emptied the backlog and SHIPPED IT ✅');
}

function maybeEndDeploying(g: Game, rng: Rng) {
  if (g.phase !== 'deploying') return;
  if (g.players.some((p) => p.status === 'deploying')) return;
  runReview(g, rng);
}

function applyKudos(g: Game, p: Player, face: KudosFace) {
  switch (face.kind) {
    case 'up':
      p.up += face.amount;
      break;
    case 'coffee':
      addCoffee(p, face.amount);
      break;
    case 'budget':
      p.budget += face.amount;
      break;
    case 'script':
      p.backlog.push(newChange(g, 'script', 1));
      break;
  }
}

function count(p: Player, type: ChangeType): number {
  return p.deployed.filter((d) => d.type === type).length;
}

/** Post-Incident Review: Kudos Die, end-of-round effects, Coffee spaces, scoring. */
function runReview(g: Game, rng: Rng) {
  g.phase = 'review';
  g.deployDeadline = null;
  const m = g.mods;
  const lines = new Map<number, string[]>();
  const say = (p: Player, s: string) => lines.get(p.seat)!.push(s);
  const startCoffee = new Map<number, number>();
  const startUp = new Map<number, number>();
  for (const p of g.players) {
    lines.set(p.seat, []);
    startCoffee.set(p.seat, p.coffee);
    startUp.set(p.seat, p.up);
  }

  // 1. Kudos Die: furthest player(s) whose prod stayed up.
  const alive = g.players.filter((p) => p.status !== 'down');
  if (alive.length > 0) {
    const best = Math.max(...alive.map((p) => p.position));
    for (const p of alive.filter((x) => x.position === best)) {
      for (let r = 0; r < m.kudosRolls; r++) {
        const face = KUDOS_DIE[rng.int(KUDOS_DIE.length)];
        applyKudos(g, p, face);
        p.stats.kudos += 1;
        g.kudos.push({ seat: p.seat, face });
        say(p, `🎲 Kudos Die: ${kudosLabel(face)}`);
        ev(g, 'kudos', p.seat, `${p.name} rolled the Kudos Die: ${kudosLabel(face)}`);
      }
    }
  }

  // 2. End-of-round change effects.
  const n = g.players.length;
  const shadow = g.players.map((p) => count(p, 'shadowit'));
  g.players.forEach((p, i) => {
    // Hotfix: last or second-to-last change.
    const tail = p.deployed.slice(-m.hotfixWindow);
    const hf = tail.filter((d) => d.type === 'hotfix').length;
    if (hf > 0) {
      addCoffee(p, hf);
      say(p, `🩹 Late Hotfix: +${hf} ☕`);
    }
    // Shadow IT vs neighbors.
    if (shadow[i] > 0) {
      const left = shadow[(i - 1 + n) % n];
      const right = shadow[(i + 1) % n];
      const beats = (shadow[i] > left ? 1 : 0) + (shadow[i] > right ? 1 : 0);
      if (beats === 2) {
        p.position += 1;
        addCoffee(p, 1);
        say(p, '🕶️ Most Shadow IT on the floor: +1 space, +1 ☕');
      } else if (beats === 1) {
        p.position += 1;
        say(p, '🕶️ Out-shadowed a neighbor: +1 space');
      }
    }
    // Exec Sponsor.
    const ex = count(p, 'exec');
    if (ex > 0) {
      const eff = ex + m.execBonus;
      if (eff >= 3) {
        p.up += 2;
        p.backlog.push(newChange(g, 'script', 1));
        say(p, '👔 Exec Sponsors (3+): +2 UP and a free Script');
      } else if (eff === 2) {
        p.up += 1;
        addCoffee(p, 1);
        say(p, '👔 Exec Sponsors (2): +1 UP, +1 ☕');
      } else {
        p.up += 1;
        say(p, '👔 Exec Sponsor: +1 UP');
      }
    }
    if (m.complianceBonus && shadow[i] === 0) {
      p.up += 1;
      say(p, '📋 Compliance bonus: +1 UP');
    }
    if (m.retroBonus && p.status === 'shipped' && p.bugTotal <= 4) {
      p.up += 2;
      say(p, '🔁 Sprint Retro: +2 UP');
    }
  });

  // 3. Coffee spaces and 4. Budget / UP.
  for (const p of g.players) {
    const space = Math.min(p.position, LAST_SPACE);
    p.position = space;
    const cell = PIPELINE[space];
    if (cell.coffee) {
      addCoffee(p, 1);
      say(p, '☕ Landed on a Coffee space: +1 ☕');
    }
    const budget = Math.max(0, cell.budget + m.budgetDelta);
    if (p.status !== 'down' || m.downTakesBoth) {
      p.budget += budget;
      p.up += cell.up;
      say(p, `Space ${space}: +$${budget} and +${cell.up} UP`);
    } else {
      p.pendingScoreChoice = true;
      say(p, `PROD DOWN on space ${space}: fix it ($${budget}) or explain it (+${cell.up} UP)`);
    }
    p.summary = {
      space,
      status: p.status,
      lines: lines.get(p.seat)!,
      budget: p.budget,
      up: p.up - startUp.get(p.seat)!,
      coffee: p.coffee - startCoffee.get(p.seat)!,
    };
  }
}

function finalize(g: Game) {
  g.phase = 'final';
  for (const p of g.players) {
    const fromBudget = Math.floor(p.budget / BUDGET_PER_UP);
    const fromCoffee = Math.floor(p.coffee / COFFEE_PER_UP);
    p.up += fromBudget + fromCoffee;
    p.summary = {
      space: p.position,
      status: p.status,
      lines: [`Leftover $${p.budget} → +${fromBudget} UP`, `Leftover ${p.coffee} ☕ → +${fromCoffee} UP`],
      budget: p.budget,
      up: fromBudget + fromCoffee,
      coffee: p.coffee,
    };
  }
  ev(g, 'final', null, 'Change window closed. Employee of the Month is…');
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function reduce(game: Game, action: Action): Game {
  const g: Game = structuredClone(game);
  const rng = new Rng(g.rng);
  apply(g, action, rng);
  g.rng = rng.state;
  return g;
}

function requirePhase(g: Game, ...phases: Game['phase'][]) {
  if (!phases.includes(g.phase)) throw new RuleError(`Not allowed during ${g.phase}`);
}

function apply(g: Game, a: Action, rng: Rng) {
  switch (a.type) {
    case 'join': {
      const existing = g.players.find((p) => p.key === a.key && !p.bot);
      const avatar = AVATARS.some((x) => x.id === a.avatar) ? a.avatar : AVATARS[0].id;
      if (existing) {
        existing.connected = true;
        if (g.phase === 'lobby') {
          existing.name = cleanName(a.name);
          existing.avatar = avatar;
        }
        return;
      }
      if (g.phase !== 'lobby') throw new RuleError('The game already left the lobby. You can watch as a spectator.');
      if (g.players.length >= MAX_SEATS) throw new RuleError('The room is full (6 players)');
      const p = newPlayer(g, nextSeat(g), cleanName(a.name), avatar, a.key, null);
      g.players.push(p);
      ev(g, 'join', p.seat, `${p.name} joined the change window`);
      return;
    }
    case 'setConnected': {
      const p = g.players.find((x) => x.key === a.key);
      if (p) p.connected = a.connected;
      return;
    }
    case 'addBot': {
      requirePhase(g, 'lobby');
      if (g.players.length >= MAX_SEATS) throw new RuleError('The room is full (6 players)');
      if (a.bot === 'vendor' && g.players.some((p) => p.bot === 'vendor')) throw new RuleError('Legacy Vendor is already here');
      const n = g.players.filter((p) => p.bot === 'dev').length + 1;
      const seat = nextSeat(g);
      const p =
        a.bot === 'vendor'
          ? newPlayer(g, seat, 'Legacy Vendor', 'vendor', `bot-vendor`, 'vendor')
          : newPlayer(g, seat, `Bot ${n}`, 'bot', `bot-${seat}-${n}`, 'dev');
      g.players.push(p);
      ev(g, 'join', p.seat, `${p.name} joined the change window`);
      return;
    }
    case 'removePlayer': {
      requirePhase(g, 'lobby');
      g.players = g.players.filter((p) => p.seat !== a.seat);
      return;
    }
    case 'settings': {
      const s = a.settings;
      if (s.deployTimer !== undefined) g.settings.deployTimer = Math.max(0, Math.min(600, Math.round(s.deployTimer)));
      if (s.legacyVendor !== undefined) g.settings.legacyVendor = !!s.legacyVendor;
      if (s.sound !== undefined) g.settings.sound = !!s.sound;
      return;
    }
    case 'start': {
      requirePhase(g, 'lobby');
      if (a.seed !== undefined) {
        g.seed = a.seed >>> 0;
        rng.state = g.seed;
      }
      const humanCount = humans(g).length;
      const wantVendor = g.settings.legacyVendor && humanCount >= 1 && humanCount <= 3;
      if (wantVendor && !g.players.some((p) => p.bot === 'vendor') && g.players.length < MAX_SEATS) {
        apply(g, { type: 'addBot', bot: 'vendor' }, rng);
      }
      if (!wantVendor) g.players = g.players.filter((p) => p.bot !== 'vendor');
      if (g.players.length < 2) throw new RuleError('Need at least 2 players (add a bot in dev mode)');
      g.players.sort((x, y) => x.seat - y.seat);
      g.cabDeck = rng.shuffle(CAB_NOTICES.map((c) => c.id)).slice(0, ROUNDS);
      startRound(g, rng);
      return;
    }
    case 'beginDeploy': {
      requirePhase(g, 'cab');
      g.phase = 'deploying';
      g.deployDeadline = g.settings.deployTimer > 0 ? a.now + g.settings.deployTimer * 1000 : null;
      g.players.forEach((p) => (p.status = 'deploying'));
      return;
    }
    case 'draw': {
      requirePhase(g, 'deploying');
      const p = getPlayer(g, a.seat);
      if (p.status !== 'deploying') throw new RuleError('You are not deploying');
      if (p.pendingLogReview) throw new RuleError('Finish your Log Review first');
      if (p.pile.length === 0) {
        ship(g, p, 'emptied the backlog and SHIPPED IT ✅');
      } else {
        placeChange(g, p, drawRandom(p, rng), rng);
      }
      maybeEndDeploying(g, rng);
      return;
    }
    case 'logReviewPick': {
      requirePhase(g, 'deploying');
      const p = getPlayer(g, a.seat);
      const opts = p.pendingLogReview;
      if (!opts) throw new RuleError('No Log Review pending');
      p.pendingLogReview = null;
      if (a.index === null) {
        p.pile.push(...opts);
        ev(g, 'info', p.seat, `${p.name} reviewed the logs and deployed nothing`);
        if (p.pile.length === 0) ship(g, p);
      } else {
        if (!Number.isInteger(a.index) || a.index < 0 || a.index >= opts.length) {
          p.pendingLogReview = opts;
          throw new RuleError('Invalid choice');
        }
        const [chosen] = opts.splice(a.index, 1);
        p.pile.push(...opts);
        placeChange(g, p, chosen, rng);
      }
      maybeEndDeploying(g, rng);
      return;
    }
    case 'ship': {
      requirePhase(g, 'deploying');
      const p = getPlayer(g, a.seat);
      if (p.status !== 'deploying') throw new RuleError('You are not deploying');
      ship(g, p);
      maybeEndDeploying(g, rng);
      return;
    }
    case 'rollback': {
      requirePhase(g, 'deploying');
      const p = getPlayer(g, a.seat);
      if (p.status !== 'deploying') throw new RuleError('You are not deploying');
      if (!p.rollbackCharged) throw new RuleError('Rollback is not charged (3 ☕ to recharge)');
      if (p.pendingLogReview) throw new RuleError('Finish your Log Review first');
      const last = p.deployed[p.deployed.length - 1];
      if (!last || last.type !== 'bug') throw new RuleError('You can only roll back a Bug you just drew');
      p.deployed.pop();
      p.position -= last.moved;
      p.bugTotal -= last.bugPoints;
      if (last.value === 3) p.bug3s -= 1;
      p.pile.push({ id: last.id, type: last.type, value: last.value });
      p.rollbackCharged = false;
      ev(g, 'rollback', p.seat, `${p.name} rolled back a Bug ${last.value} ⏪`);
      return;
    }
    case 'timeout': {
      requirePhase(g, 'deploying');
      g.players.filter((p) => p.status === 'deploying').forEach((p) => ship(g, p, 'ran out of time and auto-SHIPPED ⏰'));
      maybeEndDeploying(g, rng);
      return;
    }
    case 'chooseScore': {
      requirePhase(g, 'review');
      const p = getPlayer(g, a.seat);
      if (!p.pendingScoreChoice) throw new RuleError('Nothing to choose');
      const cell = PIPELINE[p.position];
      if (a.pick === 'budget') {
        const b = Math.max(0, cell.budget + g.mods.budgetDelta);
        p.budget += b;
        p.summary?.lines.push(`Chose to fix it: +$${b}`);
      } else {
        p.up += cell.up;
        if (p.summary) p.summary.up += cell.up;
        p.summary?.lines.push(`Chose to explain it: +${cell.up} UP`);
      }
      if (p.summary) p.summary.budget = p.budget;
      p.pendingScoreChoice = false;
      return;
    }
    case 'toVendor': {
      requirePhase(g, 'review');
      if (g.players.some((p) => p.pendingScoreChoice)) throw new RuleError('Waiting on outage choices');
      if (g.round >= ROUNDS) {
        finalize(g);
        return;
      }
      g.phase = 'vendor';
      return;
    }
    case 'buy': {
      const err = validateBuy(g, a.seat, a.changeType, a.value);
      if (err) throw new RuleError(err);
      const p = getPlayer(g, a.seat);
      p.budget -= priceOf(g, a.changeType, a.value)!;
      p.backlog.push(newChange(g, a.changeType, a.value));
      p.purchases.push(a.changeType);
      ev(g, 'buy', p.seat, `${p.name} bought ${CHANGES[a.changeType].name} ${a.value}`);
      return;
    }
    case 'recharge': {
      requirePhase(g, 'vendor');
      const p = getPlayer(g, a.seat);
      if (p.vendorDone) throw new RuleError('You already closed the Vendor Portal');
      if (p.rollbackCharged) throw new RuleError('Rollback is already charged');
      if (p.coffee < ROLLBACK_RECHARGE_COST) throw new RuleError(`Need ${ROLLBACK_RECHARGE_COST} ☕`);
      p.coffee -= ROLLBACK_RECHARGE_COST;
      p.rollbackCharged = true;
      return;
    }
    case 'improve': {
      requirePhase(g, 'vendor');
      const p = getPlayer(g, a.seat);
      if (p.vendorDone) throw new RuleError('You already closed the Vendor Portal');
      if (p.coffee < PROCESS_IMPROVEMENT_COST) throw new RuleError(`Need ${PROCESS_IMPROVEMENT_COST} ☕`);
      if (p.startPos >= MAX_START_POS) throw new RuleError('Process is already world-class');
      p.coffee -= PROCESS_IMPROVEMENT_COST;
      p.startPos += 1;
      return;
    }
    case 'vendorDone': {
      requirePhase(g, 'vendor');
      const p = getPlayer(g, a.seat);
      p.vendorDone = true;
      if (g.players.every((x) => x.vendorDone)) startRound(g, rng);
      return;
    }
  }
}

/** Safe wrapper for networking code: returns the error instead of throwing. */
export function tryReduce(game: Game, action: Action): { game: Game; error: string | null } {
  try {
    return { game: reduce(game, action), error: null };
  } catch (e) {
    if (e instanceof RuleError) return { game, error: e.message };
    throw e;
  }
}

/** Standings, best first. Ties broken by final pipeline position, then Coffee. */
export function standings(g: Game): Player[] {
  return [...g.players].sort((a, b) => b.up - a.up || b.position - a.position || b.coffee - a.coffee);
}

export interface Award {
  title: string;
  seat: number;
  detail: string;
}

export function awards(g: Game): Award[] {
  const out: Award[] = [];
  const pick = (title: string, score: (p: Player) => number, detail: (p: Player) => string, min = 1) => {
    const best = [...g.players].sort((a, b) => score(b) - score(a))[0];
    if (best && score(best) >= min) out.push({ title, seat: best.seat, detail: detail(best) });
  };
  pick('Most Outages 🔥', (p) => p.stats.outages, (p) => `${p.stats.outages} times prod went down`);
  pick('Biggest Single Deploy 🚀', (p) => p.stats.biggestDeploy, (p) => `reached space ${p.stats.biggestDeploy}`);
  pick('Coffee Hoarder ☕', (p) => p.stats.maxCoffee, (p) => `held ${p.stats.maxCoffee} ☕ at once`);
  pick('Friday Deployer 📅', (p) => p.stats.riskiestShip, (p) => `shipped with ${p.stats.riskiestShip} Bug points`, 0);
  return out;
}

export function bugsInPile(p: Player): number {
  return p.pile.filter((c) => c.type === 'bug').reduce((s, c) => s + c.value, 0);
}
