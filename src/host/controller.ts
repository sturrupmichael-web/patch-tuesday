/**
 * Host-side game loop: owns the authoritative Game, validates phone actions
 * through the pure rules engine, drives bots and timers, and broadcasts state.
 */
import { botAction } from '../engine/bot';
import { createGame, tryReduce } from '../engine/engine';
import { tokenKey } from '../engine/rng';
import type { Action, Game, Settings } from '../engine/types';
import { projectGame, type ActionEnvelope, type PhoneMsg, type StateMsg } from '../net/protocol';
import { createTransport, type Transport } from '../net/transport';

const STORAGE_KEY = 'patch-tuesday-host';
export const CAB_REVEAL_MS = 9000;
export const REVIEW_MS = 12000;
const BOT_TICK_MS = 850;
const HEARTBEAT_TIMEOUT_MS = 15000;

export class HostController {
  game: Game;
  readonly transport: Transport;
  phaseSince = Date.now();
  autoAdvance = true;
  private listeners: Array<(g: Game, prev: Game) => void> = [];
  private lastSeen = new Map<string, number>();
  private broadcastTimer: number | null = null;
  private stateVersion = 0;
  private lastBotTick = 0;

  constructor(
    readonly room: string,
    saved?: Game,
  ) {
    this.game = saved ?? createGame((Math.random() * 2 ** 32) >>> 0);
    this.transport = createTransport(room);
    this.transport.on('action', (env: ActionEnvelope) => this.onPhone(env));
    void this.transport.ready.then(() => this.broadcast());
    window.setInterval(() => this.tick(), 250);
    window.setInterval(() => this.broadcast(), 4000); // heartbeat so phones know the host is alive
    window.addEventListener('beforeunload', () => {
      this.transport.send('closed', {});
    });
  }

  static restore(): { room: string; game: Game } | null {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  onChange(cb: (g: Game, prev: Game) => void) {
    this.listeners.push(cb);
  }

  dispatch(action: Action): string | null {
    const prev = this.game;
    const { game, error } = tryReduce(prev, action);
    if (error) return error;
    if (game.phase !== prev.phase) this.phaseSince = Date.now();
    this.game = game;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ room: this.room, game }));
    } catch {
      /* storage full or blocked: the game still runs */
    }
    this.listeners.forEach((l) => l(game, prev));
    this.scheduleBroadcast();
    return null;
  }

  updateSettings(s: Partial<Settings>) {
    this.dispatch({ type: 'settings', settings: s });
  }

  private onPhone(env: ActionEnvelope) {
    if (!env || typeof env.token !== 'string' || env.token.length < 8 || !env.msg) return;
    const key = tokenKey(env.token);
    this.lastSeen.set(key, Date.now());
    const player = this.game.players.find((p) => p.key === key);
    if (player && !player.connected) this.dispatch({ type: 'setConnected', key, connected: true });
    const msg = env.msg as PhoneMsg;
    if (msg.type === 'hello') {
      this.scheduleBroadcast();
      return;
    }
    let action: Action | null = null;
    if (msg.type === 'join') {
      action = { type: 'join', key, name: String(msg.name ?? ''), avatar: String(msg.avatar ?? '') };
      if (this.game.phase !== 'lobby' && !player) {
        // Late joiner: they become a spectator. The state broadcast tells them so.
        this.scheduleBroadcast();
        return;
      }
    } else {
      if (!player) return this.sendError(key, 'You are not seated in this game');
      const seat = player.seat;
      switch (msg.type) {
        case 'draw':
        case 'ship':
        case 'rollback':
        case 'recharge':
        case 'improve':
        case 'vendorDone':
          action = { type: msg.type, seat };
          break;
        case 'logReviewPick':
          action = { type: 'logReviewPick', seat, index: msg.index === null ? null : Number(msg.index) };
          break;
        case 'chooseScore':
          action = { type: 'chooseScore', seat, pick: msg.pick === 'up' ? 'up' : 'budget' };
          break;
        case 'buy':
          action = { type: 'buy', seat, changeType: msg.changeType, value: Number(msg.value) };
          break;
      }
    }
    if (!action) return;
    const err = this.dispatch(action);
    if (err) this.sendError(key, err);
  }

  private sendError(key: string, message: string) {
    this.transport.send('error', { key, message });
  }

  private scheduleBroadcast() {
    if (this.broadcastTimer !== null) return;
    this.broadcastTimer = window.setTimeout(() => {
      this.broadcastTimer = null;
      this.broadcast();
    }, 200);
  }

  broadcast() {
    const { game, priv } = projectGame(this.game);
    const msg: StateMsg = { v: ++this.stateVersion, room: this.room, now: Date.now(), game, private: priv };
    this.transport.send('state', msg);
  }

  close() {
    this.transport.send('closed', {});
    sessionStorage.removeItem(STORAGE_KEY);
  }

  private tick() {
    const g = this.game;
    const now = Date.now();

    // Phones that stopped sending heartbeats.
    for (const p of g.players) {
      if (p.bot || !p.connected) continue;
      const seen = this.lastSeen.get(p.key) ?? 0;
      if (seen === 0) this.lastSeen.set(p.key, now);
      else if (now - seen > HEARTBEAT_TIMEOUT_MS) this.dispatch({ type: 'setConnected', key: p.key, connected: false });
    }

    if (g.phase === 'deploying' && g.deployDeadline && now >= g.deployDeadline) {
      this.dispatch({ type: 'timeout' });
      return;
    }
    if (this.autoAdvance && g.phase === 'cab' && now - this.phaseSince > CAB_REVEAL_MS) {
      this.dispatch({ type: 'beginDeploy', now });
      return;
    }
    if (
      this.autoAdvance &&
      g.phase === 'review' &&
      now - this.phaseSince > REVIEW_MS &&
      !g.players.some((p) => p.pendingScoreChoice)
    ) {
      this.dispatch({ type: 'toVendor' });
      return;
    }

    if (now - this.lastBotTick < BOT_TICK_MS) return;
    this.lastBotTick = now;
    // Give the CAB memo and review tally a moment before bots act.
    if (g.phase === 'review' && now - this.phaseSince < 2500) return;
    for (const p of this.game.players.filter((x) => x.bot)) {
      if (Math.random() < 0.25 && this.game.phase === 'deploying') continue; // human-ish pacing
      const a = botAction(this.game, p.seat);
      if (a) this.dispatch(a);
    }
  }
}
