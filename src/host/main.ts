import QRCode from 'qrcode';
import '../styles/host.css';
import { awards, cabById, createGame, reduce, standings, totalRounds } from '../engine/engine';
import {
  CHANGES,
  LAST_SPACE,
  MAX_SEATS,
  PIPELINE,
  avatarById,
  kudosLabel,
} from '../engine/data';
import type { Game, GameEvent, Player } from '../engine/types';
import { makeRoomCode } from '../net/protocol';
import { hasSupabase } from '../net/transport';
import { avatarBadge, chipHtml, esc, gaugeColor, render } from '../shared/ui';
import { Sfx } from './audio';
import { HostController } from './controller';

const params = new URLSearchParams(location.search);
const DEV = params.has('dev');
const sfx = new Sfx();

const restored = HostController.restore();
const room = restored?.room ?? (await HostController.findFreeRoom(makeRoomCode));
const host = new HostController(room, restored?.game);
if (!restored && params.has('seed')) {
  host.game = { ...host.game, seed: Number(params.get('seed')) >>> 0, rng: Number(params.get('seed')) >>> 0 };
}
sfx.muted = !host.game.settings.sound;

const joinUrl = `${location.origin}${import.meta.env.BASE_URL}?code=${room}`;
let qrSvg = '';
void QRCode.toString(joinUrl, { type: 'svg', margin: 1, color: { dark: '#0b0f0c', light: '#d9ffe6' } }).then((s) => {
  qrSvg = s;
  draw();
});

const app = document.getElementById('app')!;
const banners = document.getElementById('banners')!;
let lastEventId = host.game.eventSeq;

host.onChange((g, prev) => {
  sfx.muted = !g.settings.sound;
  handleEvents(g, prev);
  draw();
});
window.setInterval(draw, 250);

// ---------------------------------------------------------------------------
// Events → banners, sound, shake
// ---------------------------------------------------------------------------

function handleEvents(g: Game, prev: Game) {
  const fresh = g.events.filter((e) => e.id > lastEventId);
  lastEventId = g.eventSeq;
  for (const e of fresh) onEvent(e, g);
  if (g.phase === 'cab' && prev.phase !== 'cab') window.setTimeout(() => sfx.stamp(), 700);
}

function onEvent(e: GameEvent, g: Game) {
  const p = g.players.find((x) => x.seat === e.seat);
  switch (e.kind) {
    case 'draw':
      sfx.clack();
      break;
    case 'bug':
      sfx.clack();
      sfx.bug();
      break;
    case 'ship':
      sfx.chaChing();
      banner(`${esc(p?.name ?? '')} CORKED IT 🍾`, 'ok');
      break;
    case 'down':
      sfx.pager();
      sfx.explosion();
      banner(`KABOOM 💥 — ${esc(p?.name ?? '')}`, 'down');
      document.body.classList.remove('shake', 'alert');
      void document.body.offsetWidth;
      document.body.classList.add('shake', 'alert');
      window.setTimeout(() => document.body.classList.remove('shake', 'alert'), 2200);
      break;
    case 'rollback':
      banner(`${esc(e.text)}`, 'info');
      break;
    case 'kudos':
      banner(`🎲 ${esc(e.text)}`, 'kudos');
      break;
  }
}

function banner(html: string, kind: string) {
  const el = document.createElement('div');
  el.className = `banner banner-${kind}`;
  el.innerHTML = html;
  banners.appendChild(el);
  window.setTimeout(() => el.classList.add('out'), 2600);
  window.setTimeout(() => el.remove(), 3200);
}

// ---------------------------------------------------------------------------
// Click handling (event delegation, so morphdom re-renders keep working)
// ---------------------------------------------------------------------------

app.addEventListener('click', (ev) => {
  sfx.unlock();
  const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!t) return;
  const act = t.dataset.act!;
  const g = host.game;
  switch (act) {
    case 'start': {
      const err = host.dispatch({ type: 'start' });
      if (err) alertBox(err);
      break;
    }
    case 'add-bot':
      host.dispatch({ type: 'addBot', bot: 'dev' });
      break;
    case 'remove':
      host.dispatch({ type: 'removePlayer', seat: Number(t.dataset.seat) });
      break;
    case 'toggle-vendor':
      host.updateSettings({ legacyVendor: !g.settings.legacyVendor });
      break;
    case 'toggle-sound':
      host.updateSettings({ sound: !g.settings.sound });
      if (!host.game.settings.sound) sfx.fan(null);
      break;
    case 'begin-deploy':
      host.dispatch({ type: 'beginDeploy', now: Date.now() });
      break;
    case 'to-vendor': {
      const err = host.dispatch({ type: 'toVendor' });
      if (err) alertBox(err);
      break;
    }
    case 'force-ship':
      host.dispatch({ type: 'timeout' });
      break;
    case 'pause':
      host.autoAdvance = !host.autoAdvance;
      break;
    case 'fullscreen':
      void document.documentElement.requestFullscreen?.();
      break;
    case 'play-again':
      playAgain();
      break;
  }
  draw();
});

app.addEventListener('change', (ev) => {
  const t = ev.target as HTMLSelectElement;
  if (t.dataset.act === 'timer') host.updateSettings({ deployTimer: Number(t.value) });
  if (t.dataset.act === 'rounds') host.updateSettings({ rounds: Number(t.value) });
});

function alertBox(msg: string) {
  banner(esc(msg), 'info');
}

function playAgain() {
  const old = host.game;
  let g = createGame((Math.random() * 2 ** 32) >>> 0, old.settings);
  for (const p of old.players) {
    if (p.bot === 'dev') g = reduce(g, { type: 'addBot', bot: 'dev' });
    else if (!p.bot) g = reduce(g, { type: 'join', key: p.key, name: p.name, avatar: p.avatar });
  }
  host.game = g;
  host.dispatch({ type: 'settings', settings: {} });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const PHASE_LABEL: Record<Game['phase'], string> = {
  lobby: 'GATHERING',
  cab: 'THE OMEN',
  deploying: 'BREWING',
  review: 'JUDGING',
  vendor: 'HERB MARKET',
  final: 'THE FAIR IS OVER',
};

function draw() {
  const g = host.game;
  updateFan(g);
  let body = '';
  switch (g.phase) {
    case 'lobby':
      body = lobby(g);
      break;
    case 'final':
      body = finalScreen(g);
      break;
    default:
      body = board(g);
  }
  render(app, header(g) + body);
}

function updateFan(g: Game) {
  if (g.phase !== 'deploying') return sfx.fan(null);
  const live = g.players.filter((p) => p.status === 'deploying');
  if (!live.length) return sfx.fan(null);
  sfx.fan(Math.max(...live.map((p) => p.bugTotal / g.mods.bugLimit)));
}

function header(g: Game): string {
  const timer =
    g.phase === 'deploying' && g.deployDeadline
      ? Math.max(0, Math.ceil((g.deployDeadline - Date.now()) / 1000))
      : null;
  return `<header class="topbar">
    <div class="brand">BRIMSTONE <span>&amp;</span> BREW</div>
    <div class="status">
      ${g.round ? `<span class="pill">NIGHT ${g.round}/${totalRounds(g)}</span>` : ''}
      <span class="pill phase-${g.phase}">${PHASE_LABEL[g.phase]}</span>
      ${timer !== null ? `<span class="pill timer ${timer <= 10 ? 'hot' : ''}">⏱ ${timer}s</span>` : ''}
    </div>
    <div class="right">
      ${g.phase !== 'lobby' ? `<span class="room-small">ROOM <b>${room}</b></span>` : ''}
      <button class="ghost" data-act="toggle-sound">${g.settings.sound ? '🔊' : '🔇'}</button>
      <button class="ghost" data-act="fullscreen" title="Fullscreen">⛶</button>
    </div>
  </header>`;
}

function lobby(g: Game): string {
  const humanCount = g.players.filter((p) => !p.bot).length;
  const vendorEligible = humanCount >= 1 && humanCount <= 3;
  const seats = g.players
    .map(
      (p) => `<div class="seat ${p.connected ? '' : 'offline'}">
        ${avatarBadge(p, 1.6)}
        <div><div class="seat-name">${esc(p.name)}</div><div class="muted">${esc(avatarById(p.avatar).name)}${p.bot ? ' · bot' : ''}</div></div>
        <button class="ghost x" data-act="remove" data-seat="${p.seat}" title="Remove">✕</button>
      </div>`,
    )
    .join('');
  const empty = Array.from({ length: Math.max(0, MAX_SEATS - g.players.length) }, () => `<div class="seat empty">an empty stall…</div>`).join('');
  const canStart = g.players.length + (g.settings.legacyVendor && vendorEligible ? 1 : 0) >= 2;
  return `<main class="lobby">
    <section class="join-card">
      <div class="muted big-label">JOIN ON YOUR PHONE</div>
      <div class="url">${esc(joinUrl.replace(/^https?:\/\//, '').replace(/\?code=.*/, ''))}</div>
      <div class="code">${room}</div>
      <div class="qr">${qrSvg}</div>
      ${howToPlay()}
      ${hasSupabase() ? '' : `<div class="warn">Local mode: no Supabase env vars, so only tabs in this browser can join. See README.</div>`}
    </section>
    <section class="lobby-right">
      <h2>The Brewers <span class="muted">(${g.players.length}/${MAX_SEATS})</span></h2>
      <div class="seats">${seats}${empty}</div>
      <div class="settings">
        <label>Brew timer
          <select data-act="timer">
            ${[0, 45, 60, 90, 120, 180].map((s) => `<option value="${s}" ${g.settings.deployTimer === s ? 'selected' : ''}>${s ? s + 's' : 'off'}</option>`).join('')}
          </select>
        </label>
        <label>Game length
          <select data-act="rounds">
            <option value="9" ${totalRounds(g) === 9 ? 'selected' : ''}>Full fair (9 nights)</option>
            <option value="6" ${totalRounds(g) === 6 ? 'selected' : ''}>Quick fair (6 nights)</option>
          </select>
        </label>
        <button class="toggle ${g.settings.legacyVendor ? 'on' : ''}" data-act="toggle-vendor" ${vendorEligible ? '' : 'disabled'}>
          🦝 Rival Peddler bot: ${g.settings.legacyVendor ? 'ON' : 'OFF'} <span class="muted">(2–3 players)</span>
        </button>
        <button class="toggle ${g.settings.sound ? 'on' : ''}" data-act="toggle-sound">Sound: ${g.settings.sound ? 'ON' : 'OFF'}</button>
        ${DEV ? `<button class="toggle" data-act="add-bot">🤖 Add dev bot</button><span class="muted">seed ${g.seed}</span>` : ''}
      </div>
      <button class="start" data-act="start" ${canStart ? '' : 'disabled'}>LIGHT THE FIRES ▶</button>
      ${canStart ? '' : '<div class="muted">Need at least 2 brewers (or 1 brewer + the Rival Peddler).</div>'}
    </section>
  </main>`;
}

function howToPlay(): string {
  return `<details class="howto" open>
    <summary>How to play</summary>
    <ol>
      <li><b>Stir in</b> ingredients from your satchel on your phone. Each one moves your cauldron up the Brew Track, where the rewards grow.</li>
      <li>Watch the <b>☄️ Brimstone</b>. More than 7 and your cauldron goes <b>KABOOM</b>. <b>Cork it</b> before that, or use your <b>🥄 Ladle</b> to scoop out a bad draw.</li>
      <li>At <b>judging</b>, score Silver 🪙 and Renown ★ for your space. Exploded? Pick one, not both.</li>
      <li>Spend Silver at the <b>Herb Market</b> on better ingredients. Most Renown after the last night wins.</li>
    </ol>
  </details>`;
}

function laneStart(g: Game, p: Player): number {
  return Math.min(LAST_SPACE, p.startPos + p.headStart + g.mods.startBonus);
}

function track(g: Game, p: Player): string {
  const start = laneStart(g, p);
  const cells = PIPELINE.map(
    (c, i) => `<div class="cell ${i < start ? 'pre' : ''} ${c.coffee ? 'coffee' : ''}">
      <span class="c-up">${c.up}</span><span class="c-b">${c.budget}🪙</span>${c.coffee ? '<span class="c-cof">💎</span>' : ''}
    </div>`,
  ).join('');
  let pos = start;
  const chips = p.deployed
    .map((d) => {
      pos += d.moved;
      const at = Math.min(pos, LAST_SPACE);
      return `<div class="placed" style="grid-column:${at + 1}">${chipHtml(d, 'sm')}</div>`;
    })
    .join('');
  const markerPos = Math.min(p.position, LAST_SPACE);
  return `<div class="track ${p.status}">
    <div class="cells">${cells}</div>
    <div class="chips">${chips}</div>
    <div class="marker" style="left:calc(${markerPos} * 100% / ${PIPELINE.length})"></div>
  </div>`;
}

function gauge(g: Game, p: Player): string {
  const lim = g.mods.bugLimit;
  const ratio = Math.min(1, p.bugTotal / lim);
  return `<div class="gauge" title="Brimstone">
    <div class="gauge-fill" style="width:${ratio * 100}%;background:${gaugeColor(ratio)}"></div>
    <div class="gauge-label">☄️ BRIMSTONE ${p.bugTotal}/${lim}</div>
  </div>`;
}

function statusTag(g: Game, p: Player): string {
  if (g.phase === 'vendor') return p.vendorDone ? '<span class="tag ok">DONE ✅</span>' : '<span class="tag">SHOPPING 🧺</span>';
  if (g.phase === 'review' && p.pendingScoreChoice) return '<span class="tag warn">SCRAPS OR TALE? 🤔</span>';
  switch (p.status) {
    case 'deploying':
      return p.pendingLogReview ? '<span class="tag">PEEKING 🪶</span>' : '<span class="tag live">BREWING<span class="blink">…</span></span>';
    case 'shipped':
      return '<span class="tag ok">CORKED 🍾</span>';
    case 'down':
      return '<span class="tag down">KABOOM 💥</span>';
    default:
      return '<span class="tag">WAITING</span>';
  }
}

function lane(g: Game, p: Player): string {
  const extra =
    g.phase === 'review' && p.summary
      ? `<div class="summary">${p.summary.lines.map((l, i) => `<div style="animation-delay:${0.3 + i * 0.6}s">${esc(l)}</div>`).join('')}</div>`
      : g.phase === 'vendor'
        ? `<div class="summary static">${p.purchases.length ? 'Bought: ' + p.backlog.slice(-p.purchases.length).map((c) => chipHtml(c, 'sm')).join(' ') : `<span class="muted">${p.budget} 🪙 to spend</span>`}</div>`
        : '';
  return `<div class="lane ${p.status} ${p.connected || p.bot ? '' : 'offline'}" data-seat="${p.seat}">
    <div class="rack">
      <div class="rack-head">${avatarBadge(p)}<span class="name">${esc(p.name)}</span>${p.connected || p.bot ? '' : '<span class="muted">📵</span>'}</div>
      ${statusTag(g, p)}
      ${gauge(g, p)}
      <div class="rack-stats"><span>${p.up} ★</span><span>${p.coffee} 💎</span>${p.rollbackCharged ? '<span title="Ladle ready">🥄</span>' : ''}${p.headStart ? `<span class="relief" title="Underdog's Luck">+${p.headStart} 🍀</span>` : ''}</div>
    </div>
    <div class="lane-main">${track(g, p)}${extra}</div>
  </div>`;
}

function leaderboard(g: Game): string {
  return `<aside class="leaderboard">
    <h3>Renown</h3>
    ${standings(g)
      .map(
        (p, i) => `<div class="lb-row"><span class="rank">#${i + 1}</span>${avatarBadge(p, 0.8)}<span class="name">${esc(p.name)}</span><span class="up">${p.up}</span></div>`,
      )
      .join('')}
  </aside>`;
}

function cabMemo(g: Game): string {
  const cab = cabById(g.cab);
  if (!cab) return '';
  return `<div class="memo-wrap"><div class="memo">
    <div class="memo-head">THE OMEN FOR NIGHT ${g.round}</div>
    <div class="memo-title">${esc(cab.title)}</div>
    <div class="memo-text">${esc(cab.text)}</div>
    <div class="stamp">✶</div>
    <button class="memo-go" data-act="begin-deploy">START BREWING ▶</button>
    <div class="memo-foot">${g.players.filter((p) => p.headStart).map((p) => `${esc(p.name)} gets +${p.headStart} Underdog's Luck 🍀`).join(' · ') || 'Nobody needs Underdog\'s Luck tonight.'}</div>
  </div></div>`;
}

function board(g: Game): string {
  const waiting = g.players.filter((p) => p.status === 'deploying').map((p) => esc(p.name));
  let controls = '';
  if (g.phase === 'cab') controls = `<button data-act="begin-deploy">START BREWING ▶</button>`;
  if (g.phase === 'deploying')
    controls = `<span class="muted">Still brewing: ${waiting.join(', ') || '—'}</span><button class="ghost" data-act="force-ship">Cork everyone</button>`;
  if (g.phase === 'review') {
    const pending = g.players.filter((p) => p.pendingScoreChoice).map((p) => esc(p.name));
    controls = pending.length
      ? `<span class="muted">Waiting on exploded brewers: ${pending.join(', ')}</span>`
      : `<button data-act="to-vendor">${g.round >= totalRounds(g) ? 'FINAL RESULTS ▶' : 'OPEN THE HERB MARKET ▶'}</button>`;
  }
  if (g.phase === 'vendor') {
    const shopping = g.players.filter((p) => !p.vendorDone).map((p) => esc(p.name));
    controls = `<span class="muted">Shopping at the market: ${shopping.join(', ')}</span>`;
  }
  const cab = cabById(g.cab);
  const kudos =
    g.phase === 'review' && g.kudos.length
      ? `<div class="kudos">🎲 LUCKY DIE: ${g.kudos.map((k) => `${esc(g.players.find((p) => p.seat === k.seat)?.name)} → <b>${kudosLabel(k.face)}</b>`).join(' · ')}</div>`
      : '';
  return `<main class="board">
    <div class="board-main">
      <div class="subbar">
        ${cab ? `<span class="cab-chip">📋 ${esc(cab.title)}: ${esc(cab.text)}</span>` : ''}
        <span class="controls">${controls}<button class="ghost" data-act="pause" title="Auto-advance">${host.autoAdvance ? '⏸ auto' : '▶ manual'}</button></span>
      </div>
      ${kudos}
      <div class="lanes n${g.players.length}">${g.players.map((p) => lane(g, p)).join('')}</div>
      <div class="legend">${Object.values(CHANGES)
        .map((d) => `<span>${chipHtml({ type: d.type, value: 1 }, 'xs')} ${esc(d.name)}</span>`)
        .join('')}</div>
    </div>
    ${leaderboard(g)}
    ${g.phase === 'cab' ? cabMemo(g) : ''}
  </main>`;
}

function finalScreen(g: Game): string {
  const s = standings(g);
  const podium = [s[1], s[0], s[2]]
    .map((p, i) =>
      p
        ? `<div class="podium-col p${[2, 1, 3][i]}">
        ${avatarBadge(p, 2.4)}
        <div class="name">${esc(p.name)}</div>
        <div class="up">${p.up} ★</div>
        <div class="block">${[2, 1, 3][i]}</div>
      </div>`
        : '<div></div>',
    )
    .join('');
  const aw = awards(g)
    .map((a) => {
      const p = g.players.find((x) => x.seat === a.seat)!;
      return `<div class="award"><div class="award-title">${esc(a.title)}</div><div>${avatarBadge(p, 0.8)} ${esc(p.name)}</div><div class="muted">${esc(a.detail)}</div></div>`;
    })
    .join('');
  const rows = s
    .map(
      (p, i) => `<tr><td>#${i + 1}</td><td>${avatarBadge(p, 0.7)} ${esc(p.name)}</td><td>${p.up}</td><td class="muted">${esc(p.summary?.lines.join(' · ') ?? '')}</td></tr>`,
    )
    .join('');
  return `<main class="final">
    <h1>🏆 GRAND ALCHEMIST OF THE FAIR 🏆</h1>
    <div class="podium">${podium}</div>
    <div class="awards">${aw}</div>
    <table class="standings">${rows}</table>
    <button class="start" data-act="play-again">NEW FAIR ↻</button>
  </main>`;
}

draw();
