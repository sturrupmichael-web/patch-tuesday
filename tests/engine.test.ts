import { describe, expect, it } from 'vitest';
import {
  explodeChance,
  totalRounds,
  createGame,
  reduce,
  tryReduce,
  validateBuy,
  reliefIcons,
  priceOf,
  standings,
  awards,
} from '../src/engine/engine';
import { botAction } from '../src/engine/bot';
import { CAB_NOTICES, DEFAULT_MODS, LAST_SPACE, PIPELINE, ROUNDS, type ChangeType } from '../src/engine/data';
import { nextRandom } from '../src/engine/rng';
import type { Action, Game } from '../src/engine/types';

let ids = 1000;
const chip = (type: ChangeType, value: number) => ({ id: ids++, type, value });

/** A 2-human game in the deploying phase, round 1, with a neutral CAB notice. */
function deploying(players = 2, seed = 42): Game {
  let g = createGame(seed, { legacyVendor: false, deployTimer: 0 });
  for (let i = 0; i < players; i++) g = reduce(g, { type: 'join', key: `k${i}`, name: `P${i}`, avatar: 'dba' });
  g = reduce(g, { type: 'start' });
  g = neutral(g);
  return reduce(g, { type: 'beginDeploy', now: 0 });
}

/** Strip the CAB Notice so tests see default rules. */
function neutral(g: Game): Game {
  const c = structuredClone(g);
  c.cab = null;
  c.mods = { ...DEFAULT_MODS };
  for (const p of c.players) {
    p.position = p.startPos;
    p.headStart = 0;
  }
  return c;
}

function setPile(g: Game, seat: number, pile: ReturnType<typeof chip>[]): Game {
  const c = structuredClone(g);
  c.players[seat].pile = pile;
  return c;
}

const draw = (g: Game, seat = 0) => reduce(g, { type: 'draw', seat });

describe('setup', () => {
  it('starting backlog is 4x Bug1, 2x Bug2, 1x Bug3, Hotfix 1, Script 1', () => {
    const g = deploying();
    const b = g.players[0].backlog.map((c) => `${c.type}${c.value}`).sort();
    expect(b).toEqual(['bug1', 'bug1', 'bug1', 'bug1', 'bug2', 'bug2', 'bug3', 'hotfix1', 'script1'].sort());
    expect(g.players[0].pile).toHaveLength(9);
    expect(g.round).toBe(1);
    expect(g.cabDeck).toHaveLength(ROUNDS - 1);
  });

  it('adds Legacy Vendor with 2-3 humans when enabled, not with 4', () => {
    let g = createGame(1, { legacyVendor: true });
    g = reduce(g, { type: 'join', key: 'a', name: 'A', avatar: 'dba' });
    g = reduce(g, { type: 'join', key: 'b', name: 'B', avatar: 'dba' });
    const started = reduce(g, { type: 'start' });
    expect(started.players.map((p) => p.bot)).toEqual([null, null, 'vendor']);
    for (const k of ['c', 'd']) g = reduce(g, { type: 'join', key: k, name: k, avatar: 'dba' });
    expect(reduce(g, { type: 'start' }).players.some((p) => p.bot)).toBe(false);
  });

  it('rejoining with the same key reuses the seat; strangers after start cannot join', () => {
    let g = deploying();
    g = reduce(g, { type: 'setConnected', key: 'k0', connected: false });
    expect(g.players[0].connected).toBe(false);
    g = reduce(g, { type: 'join', key: 'k0', name: 'x', avatar: 'dba' });
    expect(g.players[0].connected).toBe(true);
    expect(g.players).toHaveLength(2);
    expect(tryReduce(g, { type: 'join', key: 'new', name: 'late', avatar: 'dba' }).error).toMatch(/lobby/);
  });

  it('caps the room at 6 seats', () => {
    let g = createGame(1);
    for (let i = 0; i < 6; i++) g = reduce(g, { type: 'join', key: `k${i}`, name: `${i}`, avatar: 'dba' });
    expect(tryReduce(g, { type: 'join', key: 'k7', name: '7', avatar: 'dba' }).error).toMatch(/full/);
  });

  it('does not mutate the input state', () => {
    const g = deploying();
    const snapshot = JSON.stringify(g);
    draw(g);
    expect(JSON.stringify(g)).toBe(snapshot);
  });
});

describe('seeded backlog draws', () => {
  it('rng is deterministic', () => {
    expect(nextRandom(123)).toEqual(nextRandom(123));
  });

  it('the same seed and actions replay identically', () => {
    const play = () => {
      let g = deploying(2, 777);
      for (let i = 0; i < 4; i++) g = draw(g, 0);
      return g.players[0].deployed.map((d) => d.id);
    };
    expect(play()).toEqual(play());
  });

  it('a draw moves the change from pile to deployed and advances the marker', () => {
    let g = setPile(deploying(), 0, [chip('script', 1), chip('hotfix', 2)]);
    g = draw(g);
    const p = g.players[0];
    expect(p.pile).toHaveLength(1);
    expect(p.deployed).toHaveLength(1);
    expect(p.position).toBe(p.deployed[0].value);
  });

  it('auto-ships when the backlog runs out', () => {
    let g = setPile(deploying(), 0, [chip('script', 1)]);
    g = draw(g);
    expect(g.players[0].status).toBe('shipped');
  });
});

describe('PROD DOWN threshold', () => {
  it('7 Bug points is fine, 8 goes down', () => {
    const at7 = draw(setPile(withBugs(deploying(), 4), 0, [chip('bug', 3)]));
    expect(at7.players[0].bugTotal).toBe(7);
    expect(at7.players[0].status).not.toBe('down');

    const at8 = draw(setPile(withBugs(deploying(), 5), 0, [chip('bug', 3)]));
    expect(at8.players[0].bugTotal).toBe(8);
    expect(at8.players[0].status).toBe('down');
    expect(at8.players[0].stats.outages).toBe(1);
  });

  it('a downed player cannot keep drawing or ship', () => {
    const g = draw(setPile(withBugs(deploying(), 5), 0, [chip('bug', 3)]));
    expect(tryReduce(g, { type: 'draw', seat: 0 }).error).toBeTruthy();
    expect(tryReduce(g, { type: 'ship', seat: 0 }).error).toBeTruthy();
  });

  it('CAB bug limit modifiers apply', () => {
    let g = withBugs(deploying(), 7);
    g.mods.bugLimit = 9;
    g = draw(setPile(g, 0, [chip('bug', 2)]));
    expect(g.players[0].status).not.toBe('down');
  });
});

function withBugs(g: Game, total: number): Game {
  const c = structuredClone(g);
  c.players[0].bugTotal = total;
  return c;
}

describe('Rollback', () => {
  it('returns the last Bug to the backlog and spends the charge', () => {
    let g = deployedState(deploying(), 0, [['script', 1], ['bug', 2]]);
    g = setPile(g, 0, [chip('script', 1)]);
    g = reduce(g, { type: 'rollback', seat: 0 });
    const p = g.players[0];
    expect(p.bugTotal).toBe(0);
    expect(p.position).toBe(1);
    expect(p.pile.some((c) => c.type === 'bug' && c.value === 2)).toBe(true);
    expect(p.rollbackCharged).toBe(false);
    expect(p.status).toBe('deploying');
  });

  it('only one Rollback until recharged', () => {
    let g = deployedState(deploying(), 0, [['bug', 1]]);
    g = reduce(g, { type: 'rollback', seat: 0 });
    g = deployedState(g, 0, [['bug', 1]]);
    expect(tryReduce(g, { type: 'rollback', seat: 0 }).error).toMatch(/Ladle/);
  });

  it('cannot roll back a non-Bug', () => {
    let g = setPile(deploying(), 0, [chip('script', 1), chip('script', 1)]);
    g = draw(g);
    expect(tryReduce(g, { type: 'rollback', seat: 0 }).error).toMatch(/Brimstone/);
  });

  it('recharging costs 3 Coffee in the Vendor Portal', () => {
    let g = toVendor(deploying());
    g = structuredClone(g);
    g.players[0].rollbackCharged = false;
    g.players[0].coffee = 2;
    expect(tryReduce(g, { type: 'recharge', seat: 0 }).error).toMatch(/3/);
    g.players[0].coffee = 4;
    g = reduce(g, { type: 'recharge', seat: 0 });
    expect(g.players[0].rollbackCharged).toBe(true);
    expect(g.players[0].coffee).toBe(1);
  });
});

/** Ship everyone and resolve choices, landing in the Vendor Portal. */
function toVendor(g: Game): Game {
  for (const p of g.players) if (p.status === 'deploying') g = reduce(g, { type: 'ship', seat: p.seat });
  for (const p of g.players) if (p.pendingScoreChoice) g = reduce(g, { type: 'chooseScore', seat: p.seat, pick: 'up' });
  return reduce(g, { type: 'toVendor' });
}

function deployedState(g: Game, seat: number, list: Array<[ChangeType, number]>): Game {
  const c = structuredClone(g);
  const p = c.players[seat];
  p.deployed = list.map(([t, v]) => ({ ...chip(t, v), moved: v, bugPoints: t === 'bug' ? v : 0 }));
  p.position = list.reduce((s, [, v]) => s + v, 0);
  p.bugTotal = list.filter(([t]) => t === 'bug').reduce((s, [, v]) => s + v, 0);
  return c;
}

describe('change effects', () => {
  it('Script: moves its value, no effect', () => {
    const g = draw(setPile(deploying(), 0, [chip('script', 1)]));
    expect(g.players[0].position).toBe(1);
    expect(g.players[0].bugTotal).toBe(0);
  });

  it('Automation: +1 per Script already deployed, max +2', () => {
    let g = deployedState(deploying(), 0, [['script', 1]]);
    g = draw(setPile(g, 0, [chip('automation', 2)]));
    expect(g.players[0].deployed.at(-1)!.moved).toBe(3);

    let h = deployedState(deploying(), 0, [['script', 1], ['script', 1], ['script', 1]]);
    h = draw(setPile(h, 0, [chip('automation', 4)]));
    expect(h.players[0].deployed.at(-1)!.moved).toBe(6);
  });

  it('Unit Test: returns the previous Bug to the backlog', () => {
    let g = deployedState(deploying(), 0, [['script', 1], ['bug', 3]]);
    g = draw(setPile(g, 0, [chip('unittest', 2)]));
    const p = g.players[0];
    expect(p.bugTotal).toBe(0);
    expect(p.deployed.map((d) => d.type)).toEqual(['script', 'unittest']);
    expect(p.position).toBe(1 + 2);
    expect(p.pile).toEqual([expect.objectContaining({ type: 'bug', value: 3 })]);
  });

  it('Unit Test: no effect when the previous change was not a Bug', () => {
    let g = deployedState(deploying(), 0, [['bug', 3], ['script', 1]]);
    g = draw(setPile(g, 0, [chip('unittest', 1)]));
    expect(g.players[0].bugTotal).toBe(3);
    expect(g.players[0].deployed).toHaveLength(3);
  });

  it('Log Review: deploy the chosen change and return the rest', () => {
    let g = structuredClone(deploying());
    const p0 = g.players[0];
    p0.pendingLogReview = [chip('bug', 3), chip('hotfix', 4), chip('script', 1)];
    p0.pile = [chip('bug', 1)];
    g = reduce(g, { type: 'logReviewPick', seat: 0, index: 1 });
    const p = g.players[0];
    expect(p.deployed.at(-1)!.type).toBe('hotfix');
    expect(p.position).toBe(4);
    expect(p.pile).toHaveLength(3);
    expect(p.pendingLogReview).toBeNull();
  });

  it('Log Review with nothing left to peek at just moves', () => {
    const g = draw(setPile(deploying(), 0, [chip('logreview', 2)]));
    expect(g.players[0].pendingLogReview).toBeNull();
    expect(g.players[0].position).toBe(2);
  });

  it('Log Review: draws up to its value from the backlog', () => {
    let g = structuredClone(deploying());
    g.players[0].pile = [chip('logreview', 2), chip('script', 1), chip('script', 1), chip('script', 1)];
    // Draw until the log review comes out.
    while (!g.players[0].deployed.some((d) => d.type === 'logreview')) g = draw(g);
    const p = g.players[0];
    expect(p.pendingLogReview!.length).toBe(Math.min(2, 4 - p.deployed.length));
    expect(tryReduce(g, { type: 'draw', seat: 0 }).error).toMatch(/Owl Feather/);
    const after = reduce(g, { type: 'logReviewPick', seat: 0, index: null });
    expect(after.players[0].pendingLogReview).toBeNull();
    expect(after.players[0].pile.length).toBe(p.pile.length + p.pendingLogReview!.length);
  });

  it('Hotfix: +1 Coffee when last or second-to-last', () => {
    let g = deployedState(deploying(), 0, [['hotfix', 1], ['script', 1], ['script', 1]]);
    g = deployedState(g, 1, [['script', 1], ['hotfix', 1], ['script', 1]]);
    g = toReview(g);
    expect(g.players[0].summary!.lines.some((l) => l.includes('Dewleaf'))).toBe(false);
    expect(g.players[1].summary!.lines.some((l) => l.includes('Dewleaf'))).toBe(true);
  });

  it('Shadow IT: beat one neighbor = +1 space; beat both = +1 space +1 Coffee', () => {
    let g = deploying(3);
    g = deployedState(g, 0, [['shadowit', 1], ['shadowit', 1]]);
    g = deployedState(g, 1, [['shadowit', 1]]);
    g = deployedState(g, 2, [['shadowit', 1], ['shadowit', 1]]);
    g = toReview(g);
    // P1 (1 shadow) beats nobody; P0 (2) beats P1 only (ties P2); P2 (2) beats P1 only.
    expect(g.players[0].position).toBe(3);
    expect(g.players[1].position).toBe(1);
    expect(g.players[2].position).toBe(3);

    let h = deploying(3);
    h = deployedState(h, 0, [['shadowit', 1], ['shadowit', 1]]);
    h = deployedState(h, 1, [['shadowit', 1]]);
    h = deployedState(h, 2, [['script', 1]]);
    h = toReview(h);
    expect(h.players[0].position).toBe(3);
    expect(h.players[0].summary!.lines.join()).toMatch(/\+1 💎/);
  });

  it('Exec Sponsor: 1 / 2 / 3+ deployed', () => {
    const run = (n: number) => {
      let g = deploying();
      g = deployedState(g, 0, Array.from({ length: n }, () => ['exec', 1] as [ChangeType, number]));
      g = deployedState(g, 1, [['script', 1]]);
      g = structuredClone(g);
      g.players[0].position = 0; // isolate exec effect from space scoring
      return toReview(g);
    };
    const one = run(1).players[0];
    expect(one.summary!.lines.join()).toMatch(/Starbloom: \+1 ★/);
    const two = run(2).players[0];
    expect(two.summary!.lines.join()).toMatch(/\+1 ★, \+1 💎/);
    const three = run(3).players[0];
    expect(three.summary!.lines.join()).toMatch(/\+2 ★ and a free Carrot/);
    expect(three.backlog.filter((c) => c.type === 'script').length).toBe(2);
  });

  it('Read-Only Friday doubles the first change only', () => {
    let g = structuredClone(deploying());
    g.mods.firstChangeDouble = true;
    g.players[0].pile = [chip('script', 1)];
    g = draw(g);
    expect(g.players[0].position).toBe(2);
  });

  it('Change Freeze auto-ships on the second Bug 3', () => {
    let g = structuredClone(deploying());
    g.mods.freezeOn3s = true;
    g = deployedState(g, 0, [['bug', 3], ['bug', 2]]);
    g.players[0].bug3s = 1;
    g = draw(setPile(g, 0, [chip('bug', 3)]));
    // 8 Bug points would normally be PROD DOWN; the freeze ships instead.
    expect(g.players[0].bugTotal).toBe(8);
    expect(g.players[0].status).toBe('shipped');
  });
});

function toReview(g: Game): Game {
  for (const p of g.players) if (p.status === 'deploying') g = reduce(g, { type: 'ship', seat: p.seat });
  expect(g.phase).toBe('review');
  return g;
}

describe('scoring (Post-Incident Review)', () => {
  it('prod up: gain both Budget and UP for the space', () => {
    let g = deployedState(deploying(), 0, [['script', 1], ['hotfix', 4], ['script', 1], ['logreview', 4], ['hotfix', 4]]);
    g = toReview(g);
    const space = 14;
    const p = g.players[0];
    expect(p.position).toBe(space);
    expect(p.budget).toBeGreaterThanOrEqual(PIPELINE[space].budget);
    expect(p.up).toBeGreaterThanOrEqual(PIPELINE[space].up);
  });

  it('prod down: choose Budget OR UP', () => {
    let g = structuredClone(deploying());
    g = deployedState(g, 0, [['script', 4], ['hotfix', 4], ['script', 4], ['script', 4]]);
    g.players[0].bugTotal = 6;
    g.players[0].pile = [chip('bug', 3)];
    g = draw(g);
    expect(g.players[0].status).toBe('down');
    g = reduce(g, { type: 'ship', seat: 1 });
    expect(g.phase).toBe('review');
    const p = g.players[0];
    expect(p.pendingScoreChoice).toBe(true);
    expect(tryReduce(g, { type: 'toVendor' }).error).toMatch(/Waiting/);
    const upBefore = p.up;
    const budgetPick = reduce(g, { type: 'chooseScore', seat: 0, pick: 'budget' });
    expect(budgetPick.players[0].budget).toBe(PIPELINE[19].budget);
    expect(budgetPick.players[0].up).toBe(upBefore);
    const upPick = reduce(g, { type: 'chooseScore', seat: 0, pick: 'up' });
    expect(upPick.players[0].up).toBe(upBefore + PIPELINE[19].up);
    expect(upPick.players[0].budget).toBe(0);
  });

  it('Kudos Die goes to the furthest player whose prod stayed up', () => {
    let g = deploying(3);
    g = deployedState(g, 0, [['script', 4], ['script', 4]]);
    g = deployedState(g, 1, [['script', 4]]);
    g = deployedState(g, 2, [['script', 4], ['script', 4], ['script', 4]]);
    g = structuredClone(g);
    g.players[2].status = 'down';
    g.players[2].bugTotal = 9;
    g = toReview(g);
    expect(g.kudos.map((k) => k.seat)).toEqual([0]);
  });

  it('Coffee space grants a Coffee', () => {
    const coffeeSpace = PIPELINE.findIndex((s) => s.coffee);
    let g = deploying();
    g = deployedState(g, 0, [['script', coffeeSpace]]);
    g = toReview(g);
    expect(g.players[0].summary!.lines.join()).toMatch(/Moonstone space/);
  });

  it('positions cap at the end of the pipeline', () => {
    let g = deployedState(deploying(), 0, [['script', 50]]);
    g = toReview(g);
    expect(g.players[0].position).toBe(LAST_SPACE);
  });
});

describe('Tech Debt Relief', () => {
  it('counts icons strictly above your UP up to the leader', () => {
    expect(reliefIcons(10, 10)).toBe(0);
    expect(reliefIcons(0, 9)).toBe(4); // 2,4,6,8
    expect(reliefIcons(5, 20)).toBe(8); // 6..20 even
  });

  it('players behind get a head start at the next round', () => {
    let g = toVendor(deploying());
    g = structuredClone(g);
    g.players[0].up = 20;
    g.players[1].up = 5;
    g.cabDeck = ['audit-season'];
    for (const p of g.players) g = reduce(g, { type: 'vendorDone', seat: p.seat });
    expect(g.round).toBe(2);
    expect(g.players[0].headStart).toBe(0);
    expect(g.players[1].headStart).toBe(8);
    expect(g.players[1].position).toBe(8);
  });
});

describe('Vendor Portal validation', () => {
  const vendor = () => {
    const g = structuredClone(toVendor(deploying()));
    g.players[0].budget = 20;
    return g;
  };

  it('allows an affordable unlocked change and deducts Budget', () => {
    const g = reduce(vendor(), { type: 'buy', seat: 0, changeType: 'hotfix', value: 2 });
    expect(g.players[0].budget).toBe(12);
    expect(g.players[0].backlog.at(-1)).toMatchObject({ type: 'hotfix', value: 2 });
  });

  it('rejects locked types in round 1, allows them later', () => {
    const g = vendor();
    expect(validateBuy(g, 0, 'automation', 1)).toMatch(/not available/);
    expect(validateBuy(g, 0, 'exec', 1)).toMatch(/not available/);
    g.round = 2;
    expect(validateBuy(g, 0, 'automation', 1)).toBeNull();
    expect(validateBuy(g, 0, 'exec', 1)).toMatch(/not available/);
    g.round = 3;
    expect(validateBuy(g, 0, 'exec', 1)).toBeNull();
  });

  it('rejects unaffordable, wrong size, Bugs, duplicates and a third purchase', () => {
    let g = vendor();
    g.players[0].budget = 8;
    expect(validateBuy(g, 0, 'logreview', 4)).toMatch(/Silver/);
    expect(validateBuy(g, 0, 'script', 2)).toMatch(/size/);
    expect(validateBuy(g, 0, 'bug', 1)).toBeTruthy();
    g = reduce(g, { type: 'buy', seat: 0, changeType: 'script', value: 1 });
    expect(validateBuy(g, 0, 'script', 1)).toMatch(/different/);
    g = reduce(g, { type: 'buy', seat: 0, changeType: 'hotfix', value: 1 });
    expect(validateBuy(g, 0, 'unittest', 1)).toMatch(/at most/);
  });

  it('Vendor Sale discount applies (min $1)', () => {
    const g = vendor();
    g.mods.priceDiscount = 2;
    expect(priceOf(g, 'hotfix', 1)).toBe(2);
    expect(priceOf(g, 'script', 1)).toBe(1);
  });

  it('process improvement moves the start marker for 2 Coffee', () => {
    let g = vendor();
    g.players[0].coffee = 2;
    g = reduce(g, { type: 'improve', seat: 0 });
    expect(g.players[0].startPos).toBe(1);
    expect(g.players[0].coffee).toBe(0);
  });

  it('unspent Budget is lost at the next change window', () => {
    let g = vendor();
    for (const p of g.players) g = reduce(g, { type: 'vendorDone', seat: p.seat });
    expect(g.players[0].budget).toBe(0);
  });

  it('host re-validates: phone cannot buy outside the vendor phase', () => {
    const g = deploying();
    expect(tryReduce(g, { type: 'buy', seat: 0, changeType: 'script', value: 1 }).error).toMatch(/closed/);
  });
});

describe('CAB Notices', () => {
  it('there are about 20 and each is valid', () => {
    expect(CAB_NOTICES.length).toBeGreaterThanOrEqual(18);
    for (const c of CAB_NOTICES) expect(c.title && c.text).toBeTruthy();
  });

  it('Audit Season gives everyone a Coffee', () => {
    let g = toVendor(deploying());
    g = structuredClone(g);
    g.cabDeck = ['audit-season'];
    const before = g.players.map((p) => p.coffee);
    for (const p of g.players) g = reduce(g, { type: 'vendorDone', seat: p.seat });
    expect(g.players.map((p) => p.coffee)).toEqual(before.map((c) => c + 1));
  });
});

describe('full game with bots', () => {
  it('plays 9 rounds to a final standings screen', () => {
    let g = createGame(2024, { legacyVendor: true, deployTimer: 0 });
    g = reduce(g, { type: 'join', key: 'h', name: 'Human', avatar: 'intern' });
    g = reduce(g, { type: 'addBot', bot: 'dev' });
    g = reduce(g, { type: 'start' });
    expect(g.players.length).toBe(3);
    // The human also plays bot strategy for this test.
    let guard = 0;
    while (g.phase !== 'final' && guard++ < 5000) {
      if (g.phase === 'cab') {
        g = reduce(g, { type: 'beginDeploy', now: 0 });
        continue;
      }
      if (g.phase === 'review' && !g.players.some((p) => p.pendingScoreChoice)) {
        g = reduce(g, { type: 'toVendor' });
        continue;
      }
      const acts = g.players.map((p) => botAction(g, p.seat)).filter(Boolean) as Action[];
      expect(acts.length).toBeGreaterThan(0);
      g = reduce(g, acts[0]);
    }
    expect(g.phase).toBe('final');
    expect(g.round).toBe(9);
    const s = standings(g);
    expect(s[0].up).toBeGreaterThanOrEqual(s[s.length - 1].up);
    expect(awards(g).length).toBeGreaterThan(0);
  });

  it('timeout auto-ships everyone still deploying', () => {
    const g = reduce(deploying(), { type: 'timeout' });
    expect(g.phase).toBe('review');
    expect(g.players.every((p) => p.status === 'shipped')).toBe(true);
  });
});

describe('batch 1: game-night fixes', () => {
  it('a stale draw (double tap) is rejected; a matching one goes through', () => {
    let g = setPile(deploying(), 0, [chip('script', 1), chip('script', 1), chip('script', 1)]);
    g = reduce(g, { type: 'draw', seat: 0, expectDraws: 0 });
    expect(g.players[0].draws).toBe(1);
    expect(tryReduce(g, { type: 'draw', seat: 0, expectDraws: 0 }).error).toMatch(/One ingredient per tap/);
    g = reduce(g, { type: 'draw', seat: 0, expectDraws: 1 });
    expect(g.players[0].draws).toBe(2);
  });

  it('explosion odds count only Brimstone that would push past the limit', () => {
    const g = deploying();
    const p = { pile: [chip('bug', 1), chip('bug', 3), chip('script', 1), chip('hotfix', 2)], bugTotal: 5, firstBugSeen: true };
    expect(explodeChance(g, p)).toBe(0.25); // only the 3 blows (5+3 > 7)
    expect(explodeChance(g, { ...p, bugTotal: 7 })).toBe(0.5);
    expect(explodeChance(g, { ...p, bugTotal: 0 })).toBe(0);
    expect(explodeChance(g, { ...p, pile: [] })).toBe(0);
    const lucky = { ...g, mods: { ...g.mods, firstBugFree: true } };
    expect(explodeChance(lucky, { ...p, bugTotal: 7, firstBugSeen: false })).toBe(0);
  });

  it('quick game: 6 nights, set only in the lobby', () => {
    let g = createGame(5, { legacyVendor: false, deployTimer: 0 });
    g = reduce(g, { type: 'settings', settings: { rounds: 6 } });
    expect(tryReduce(g, { type: 'settings', settings: { rounds: 7 } }).error).toBeTruthy();
    g = reduce(g, { type: 'addBot', bot: 'dev' });
    g = reduce(g, { type: 'addBot', bot: 'dev' });
    g = reduce(g, { type: 'start' });
    expect(totalRounds(g)).toBe(6);
    expect(g.cabDeck).toHaveLength(5);
    expect(tryReduce(g, { type: 'settings', settings: { rounds: 9 } }).error).toBeTruthy();
    let guard = 0;
    while (g.phase !== 'final' && guard++ < 5000) {
      if (g.phase === 'cab') g = reduce(g, { type: 'beginDeploy', now: 0 });
      else if (g.phase === 'review' && !g.players.some((p) => p.pendingScoreChoice)) g = reduce(g, { type: 'toVendor' });
      else g = reduce(g, g.players.map((p) => botAction(g, p.seat)).find(Boolean) as Action);
    }
    expect(g.round).toBe(6);
  });

  it('a sleeping host pushes the brewing deadline back instead of timing everyone out', () => {
    let g = createGame(1, { legacyVendor: false, deployTimer: 90 });
    g = reduce(g, { type: 'join', key: 'a', name: 'A', avatar: 'dba' });
    g = reduce(g, { type: 'join', key: 'b', name: 'B', avatar: 'dba' });
    g = reduce(g, { type: 'start' });
    g = reduce(g, { type: 'beginDeploy', now: 1000 });
    expect(g.deployDeadline).toBe(91000);
    g = reduce(g, { type: 'shiftDeadline', ms: 300000 });
    expect(g.deployDeadline).toBe(391000);
  });
});
