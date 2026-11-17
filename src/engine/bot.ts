/**
 * Bot strategy used by the Legacy Vendor and by dev-mode bots.
 * Ships once Bugs >= 5 or after 12 draws; buys randomly from affordable changes.
 * Deterministic: "random" picks are hashed from the game seed, round and seat.
 */
import { CHANGES } from './data';
import { shopItems, validateBuy } from './engine';
import { hashString } from './rng';
import type { Action, Game } from './types';

export const BOT_SHIP_BUGS = 5;
export const BOT_SHIP_DRAWS = 12;

export function botAction(g: Game, seat: number): Action | null {
  const p = g.players.find((x) => x.seat === seat);
  if (!p) return null;

  if (g.phase === 'deploying' && p.status === 'deploying') {
    if (p.pendingLogReview) {
      let best: number | null = null;
      p.pendingLogReview.forEach((c, i) => {
        if (c.type === 'bug') return;
        if (best === null || c.value > p.pendingLogReview![best].value) best = i;
      });
      return { type: 'logReviewPick', seat, index: best };
    }
    const last = p.deployed[p.deployed.length - 1];
    if (last?.type === 'bug' && p.rollbackCharged && p.bugTotal >= BOT_SHIP_BUGS) {
      return { type: 'rollback', seat };
    }
    if (p.bugTotal >= BOT_SHIP_BUGS || p.draws >= BOT_SHIP_DRAWS) return { type: 'ship', seat };
    return { type: 'draw', seat };
  }

  if (g.phase === 'review' && p.pendingScoreChoice) {
    return { type: 'chooseScore', seat, pick: g.round >= 6 ? 'up' : 'budget' };
  }

  if (g.phase === 'vendor' && !p.vendorDone) {
    const options = shopItems(g).filter((it) => validateBuy(g, seat, it.type, it.value) === null);
    if (options.length > 0) {
      const h = hashString(`${g.seed}:${g.round}:${seat}:${p.purchases.length}`);
      const it = options[h % options.length];
      return { type: 'buy', seat, changeType: it.type, value: it.value };
    }
    return { type: 'vendorDone', seat };
  }
  return null;
}

export function describeBotBuy(a: Action): string {
  return a.type === 'buy' ? `${CHANGES[a.changeType].name} ${a.value}` : '';
}
