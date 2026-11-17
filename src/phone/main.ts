import '../styles/phone.css';
import { cabById, shopItems, standings, validateBuy } from '../engine/engine';
import {
  AVATARS,
  CHANGES,
  LAST_SPACE,
  PIPELINE,
  PROCESS_IMPROVEMENT_COST,
  ROLLBACK_RECHARGE_COST,
  ROUNDS,
  avatarById,
  type ChangeType,
} from '../engine/data';
import { tokenKey } from '../engine/rng';
import type { Game, Player } from '../engine/types';
import { isRoomCode, normalizeRoomCode, type ErrorMsg, type PhoneMsg, type StateMsg } from '../net/protocol';
import { createTransport, hasSupabase, type Transport } from '../net/transport';
import { avatarBadge, chipHtml, countsByType, esc, gaugeColor, render } from '../shared/ui';

const app = document.getElementById('app')!;
const toastEl = document.getElementById('toast')!;

// Real phones keep their seat token in localStorage. In local mode (no Supabase,
// several "phones" as tabs of one browser) each tab needs its own identity, so
// sessionStorage is used instead; it still survives a refresh.
const store = (): Storage => (hasSupabase() ? localStorage : sessionStorage);
const LS = {
  get(k: string): string | null {
    try {
      return store().getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      store().setItem(k, v);
    } catch {
      /* private mode: reconnect will not survive a refresh */
    }
  },
};

function tokenFor(room: string): string {
  const k = `patch-tuesday-token-${room}`;
  let t = LS.get(k);
  if (!t) {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    t = [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
    LS.set(k, t);
  }
  return t;
}

interface Session {
  room: string;
  token: string;
  key: string;
  transport: Transport;
  state: StateMsg | null;
  lastStateAt: number;
  closed: boolean;
  joinedAt: number;
}

let session: Session | null = null;
let form = {
  code: normalizeRoomCode(new URLSearchParams(location.search).get('code') ?? LS.get('patch-tuesday-last-room') ?? ''),
  name: LS.get('patch-tuesday-name') ?? '',
  avatar: LS.get('patch-tuesday-avatar') ?? AVATARS[0].id,
};
let joinError = '';
let shopOpenType: ChangeType | null = null;

function connect(room: string, join: boolean) {
  session?.transport.close();
  const token = tokenFor(room);
  const s: Session = {
    room,
    token,
    key: tokenKey(token),
    transport: createTransport(room),
    state: null,
    lastStateAt: 0,
    closed: false,
    joinedAt: Date.now(),
  };
  session = s;
  LS.set('patch-tuesday-last-room', room);
  s.transport.on('state', (msg: StateMsg) => {
    if (session !== s || msg.room !== room) return;
    if (s.state && msg.v < s.state.v && msg.now <= s.state.now) return;
    const prev = s.state;
    s.state = msg;
    s.lastStateAt = Date.now();
    s.closed = false;
    haptics(prev, msg, s.key);
    draw();
  });
  s.transport.on('error', (e: ErrorMsg) => {
    if (session === s && e.key === s.key) toast(e.message);
  });
  s.transport.on('closed', () => {
    if (session !== s) return;
    s.closed = true;
    draw();
  });
  void s.transport.ready.then(() => {
    send({ type: 'hello' });
    if (join) send({ type: 'join', name: form.name, avatar: form.avatar });
  });
  draw();
}

function send(msg: PhoneMsg) {
  if (!session) return;
  session.transport.send('action', { token: session.token, msg });
}

// Heartbeat + reconnect when the phone wakes up.
window.setInterval(() => {
  if (session) send({ type: 'hello' });
  draw();
}, 4000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && session) send({ type: 'hello' });
});

function toast(msg: string) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  window.clearTimeout((toast as any).t);
  (toast as any).t = window.setTimeout(() => toastEl.classList.remove('show'), 2600);
}

function vibrate(p: number | number[]) {
  try {
    navigator.vibrate?.(p);
  } catch {
    /* unsupported */
  }
}

function haptics(prev: StateMsg | null, next: StateMsg, key: string) {
  const a = prev?.game.players.find((p) => p.key === key);
  const b = next.game.players.find((p) => p.key === key);
  if (!a || !b) return;
  if (a.status !== 'down' && b.status === 'down') vibrate([300, 100, 300, 100, 600]);
  else if (b.deployed.length > a.deployed.length && b.deployed[b.deployed.length - 1]?.type === 'bug') vibrate(80);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

app.addEventListener('input', (ev) => {
  const t = ev.target as HTMLInputElement;
  if (t.name === 'code') {
    form.code = normalizeRoomCode(t.value);
    t.value = form.code;
  }
  if (t.name === 'name') form.name = t.value.slice(0, 16);
});

app.addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (!isRoomCode(form.code)) {
    joinError = 'Room codes are 4 letters.';
    return draw();
  }
  if (!form.name.trim()) {
    joinError = 'Enter a name for your market stall.';
    return draw();
  }
  joinError = '';
  LS.set('patch-tuesday-name', form.name);
  LS.set('patch-tuesday-avatar', form.avatar);
  connect(form.code, true);
});

app.addEventListener('click', (ev) => {
  const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!t || (t as HTMLButtonElement).disabled) return;
  const act = t.dataset.act!;
  switch (act) {
    case 'avatar':
      form.avatar = t.dataset.id!;
      break;
    case 'draw':
      vibrate(15);
      send({ type: 'draw' });
      break;
    case 'ship':
      vibrate(40);
      send({ type: 'ship' });
      break;
    case 'rollback':
      send({ type: 'rollback' });
      break;
    case 'peek':
      send({ type: 'logReviewPick', index: t.dataset.i === 'none' ? null : Number(t.dataset.i) });
      break;
    case 'fix':
      send({ type: 'chooseScore', pick: 'budget' });
      break;
    case 'explain':
      send({ type: 'chooseScore', pick: 'up' });
      break;
    case 'open':
      shopOpenType = shopOpenType === t.dataset.type ? null : (t.dataset.type as ChangeType);
      break;
    case 'buy':
      send({ type: 'buy', changeType: t.dataset.type as ChangeType, value: Number(t.dataset.value) });
      break;
    case 'recharge':
      send({ type: 'recharge' });
      break;
    case 'improve':
      send({ type: 'improve' });
      break;
    case 'vendor-done':
      send({ type: 'vendorDone' });
      break;
    case 'rejoin':
      if (!form.name.trim()) {
        session?.transport.close();
        session = null;
      } else send({ type: 'join', name: form.name, avatar: form.avatar });
      break;
    case 'leave':
      session?.transport.close();
      session = null;
      break;
  }
  draw();
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function draw() {
  if (!session) return render(app, joinScreen());
  const s = session;
  if (s.closed) return render(app, notice('🔌 The host closed this room', 'Ask for the new room code.', true));
  if (!s.state) {
    const waited = Date.now() - s.joinedAt;
    return render(
      app,
      notice(
        `Connecting to ${esc(s.room)}…`,
        waited > 6000 ? 'No host answered. Check the room code on the big screen.' : 'Paging the host…',
        waited > 6000,
      ),
    );
  }
  const stale = Date.now() - s.lastStateAt > 12000;
  const g = s.state.game as unknown as Game;
  const me = g.players.find((p) => p.key === s.key);
  const body = me ? playerScreen(g, me, s) : spectator(g);
  render(app, (stale ? `<div class="stale">📡 Lost contact with the host… retrying</div>` : '') + body);
}

function notice(title: string, sub: string, back: boolean): string {
  return `<div class="screen center">
    <div class="logo">BRIMSTONE <span>&amp;</span> BREW</div>
    <h2>${title}</h2><p class="muted">${sub}</p>
    ${back ? '<button class="ghost" data-act="leave">Back</button>' : ''}
  </div>`;
}

function joinScreen(): string {
  return `<form class="screen join" autocomplete="off">
    <div class="logo">BRIMSTONE <span>&amp;</span> BREW</div>
    <p class="muted tagline">Just one more ingredient. What could go wrong?</p>
    <label>Room code<input name="code" value="${esc(form.code)}" maxlength="4" inputmode="text" autocapitalize="characters" placeholder="ABCD" class="code-input"></label>
    <label>Your name<input name="name" value="${esc(form.name)}" maxlength="16" placeholder="e.g. Dana"></label>
    <div class="label">Pick your brewer</div>
    <div class="avatars">${AVATARS.map(
      (a) => `<button type="button" class="av ${form.avatar === a.id ? 'sel' : ''}" data-act="avatar" data-id="${a.id}" style="--c:${a.color}">
        <span class="emoji">${a.emoji}</span><span>${esc(a.name)}</span></button>`,
    ).join('')}</div>
    ${joinError ? `<div class="err">${esc(joinError)}</div>` : ''}
    <button type="submit" class="big">JOIN THE FAIR</button>
  </form>`;
}

function topbar(g: Game, me: Player): string {
  return `<div class="ptop">${avatarBadge(me)} <b>${esc(me.name)}</b>
    <span class="stats"><span>${me.up}★</span><span>${me.coffee}💎</span>${g.phase === 'vendor' ? `<span>${me.budget}🪙</span>` : ''}</span>
    <span class="round">${g.round ? `${g.round}/${ROUNDS}` : ''}</span></div>`;
}

function playerScreen(g: Game, me: Player, s: Session): string {
  let main = '';
  switch (g.phase) {
    case 'lobby':
      main = `<div class="screen center">${avatarBadge(me, 3)}<h2>Your stall is set up!</h2>
        <p class="muted">${esc(avatarById(me.avatar).name)} · waiting for the host to start.</p>
        <p class="muted">${g.players.length} player${g.players.length === 1 ? '' : 's'} in the room</p></div>`;
      break;
    case 'cab': {
      const cab = cabById(g.cab);
      main = `<div class="screen center"><div class="memo-sm"><div class="muted">THE OMEN · NIGHT ${g.round}</div>
        <h2>${esc(cab?.title ?? 'No notice')}</h2><p>${esc(cab?.text ?? '')}</p></div>
        ${me.headStart ? `<p class="relief">🍀 Underdog's Luck: you start +${me.headStart} spaces ahead</p>` : ''}
        <p class="muted">Stoke your fire…</p></div>`;
      break;
    }
    case 'deploying':
      main = deploying(g, me, s);
      break;
    case 'review':
      main = review(g, me);
      break;
    case 'vendor':
      main = vendor(g, me);
      break;
    case 'final':
      main = finalScreen(g, me);
      break;
  }
  return topbar(g, me) + main;
}

function bugGauge(g: Game, me: Player): string {
  const lim = g.mods.bugLimit;
  const ratio = Math.min(1, me.bugTotal / lim);
  return `<div class="pgauge"><div class="fill" style="width:${ratio * 100}%;background:${gaugeColor(ratio)}"></div>
    <div class="lbl">☄️ BRIMSTONE <b>${me.bugTotal}</b> / ${lim}</div></div>`;
}

function waitingList(g: Game): string {
  const still = g.players.filter((p) => p.status === 'deploying');
  return `<div class="waiting"><div class="muted">Waiting for the others to finish brewing…</div>
    ${still.map((p) => `<div>${avatarBadge(p, 0.8)} ${esc(p.name)} <span class="muted">brewing</span></div>`).join('') || '<div class="muted">Everyone is done!</div>'}</div>`;
}

function deploying(g: Game, me: Player, s: Session): string {
  const timer = g.deployDeadline ? Math.max(0, Math.ceil((g.deployDeadline - s.state!.now - (Date.now() - s.lastStateAt)) / 1000)) : null;
  const space = Math.min(me.position, LAST_SPACE);
  const cell = PIPELINE[space];
  const last = me.deployed[me.deployed.length - 1];
  const spaceInfo = `<div class="spaceinfo">Space <b>${space}</b> · <span class="g">+${cell.up}★</span> · <span class="a">${cell.budget}🪙</span>${cell.coffee ? ' · 💎' : ''}</div>`;

  if (me.status === 'down') {
    return `<div class="screen center down-screen"><div class="boom">💥</div><h1>KABOOM!</h1>
      <p>${me.bugTotal} Brimstone. Your cauldron blew its lid for tonight.</p>${spaceInfo}
      <p class="muted">At judging: sell the scraps (🪙) or tell the tale (★). Not both.</p>${waitingList(g)}</div>`;
  }
  if (me.status === 'shipped') {
    return `<div class="screen center"><div class="boom">🍾</div><h1>CORKED IT</h1>${spaceInfo}${waitingList(g)}</div>`;
  }
  const priv = s.state!.private[s.key];
  if (me.pendingLogReview && priv?.logReview) {
    return `<div class="screen">
      ${bugGauge(g, me)}
      <h2>🪶 Owl Feather</h2><p class="muted">Pick one ingredient to add now, or none. The rest go back in the satchel.</p>
      <div class="peek">${priv.logReview
        .map(
          (c, i) => `<button class="peek-btn" data-act="peek" data-i="${i}">${chipHtml(c)} <span>${esc(CHANGES[c.type].name)} ${c.value}</span></button>`,
        )
        .join('')}</div>
      <button class="ghost big" data-act="peek" data-i="none">Add none</button>
    </div>`;
  }
  const canRollback = me.rollbackCharged && last?.type === 'bug';
  const peek = countsByType(me.pile)
    .map((c) => `<span class="pk">${chipHtml(c, 'xs')}×${c.n}</span>`)
    .join('');
  const ratio = me.bugTotal / g.mods.bugLimit;
  return `<div class="screen deploy ${ratio >= 0.7 ? 'hot' : ''}">
    <div class="row">${bugGauge(g, me)}${timer !== null ? `<div class="ptimer ${timer <= 10 ? 'hot' : ''}">${timer}s</div>` : ''}</div>
    ${spaceInfo}
    <div class="last">${last ? `${chipHtml(last)}<div><div class="muted">Last ingredient</div><b>${esc(CHANGES[last.type].name)} ${last.value}</b></div>` : '<div class="muted">The cauldron is empty. Feeling lucky?</div>'}</div>
    <button class="deploy-btn" data-act="draw">STIR IN 🥄</button>
    <div class="row2">
      <button class="ship-btn" data-act="ship">CORK IT 🍾</button>
      ${canRollback ? `<button class="rollback-btn" data-act="rollback">🥄 LADLE OUT</button>` : ''}
    </div>
    <div class="backlog"><div class="muted">Satchel (${me.pile.length} left) · Ladle ${me.rollbackCharged ? 'ready 🥄' : 'used'}</div><div class="pks">${peek}</div></div>
  </div>`;
}

function review(g: Game, me: Player): string {
  const cell = PIPELINE[Math.min(me.position, LAST_SPACE)];
  if (me.pendingScoreChoice) {
    const budget = Math.max(0, cell.budget + g.mods.budgetDelta);
    return `<div class="screen center"><h2>💥 Judging</h2>
      <p>Your cauldron exploded. Sell the scraps or tell the tale, not both.</p>
      <button class="choice a" data-act="fix">🪙 SELL THE SCRAPS<br><b>+${budget} Silver</b></button>
      <button class="choice g" data-act="explain">📖 TELL THE TALE<br><b>+${cell.up} Renown</b></button></div>`;
  }
  return `<div class="screen"><h2>Judging</h2>
    <div class="lines">${(me.summary?.lines ?? []).map((l) => `<div>${esc(l)}</div>`).join('')}</div>
    ${leaderboard(g)}</div>`;
}

function vendor(g: Game, me: Player): string {
  if (me.vendorDone) {
    const shopping = g.players.filter((p) => !p.vendorDone);
    return `<div class="screen center"><h2>🧺 Basket packed</h2><p class="muted">Waiting for: ${shopping.map((p) => esc(p.name)).join(', ')}</p>${leaderboard(g)}</div>`;
  }
  const items = shopItems(g);
  const types = [...new Set(items.map((i) => i.type))];
  const rows = types
    .map((t) => {
      const d = CHANGES[t];
      const sizes = items
        .filter((i) => i.type === t)
        .map((i) => {
          const err = validateBuy(g, me.seat, i.type, i.value);
          return `<button class="buy" data-act="buy" data-type="${i.type}" data-value="${i.value}" ${err ? 'disabled' : ''} title="${esc(err ?? '')}">
            ${chipHtml(i)}<span>${i.price}🪙</span></button>`;
        })
        .join('');
      const bought = me.purchases.includes(t);
      return `<div class="shop-row ${bought ? 'bought' : ''}">
        <div class="shop-info"><b>${d.emoji} ${esc(d.name)}</b>${bought ? ' <span class="ok">✓ bought</span>' : ''}<div class="muted">${esc(d.short)}</div></div>
        <div class="sizes">${sizes}</div></div>`;
    })
    .join('');
  const sale = g.mods.priceDiscount ? `<div class="sale">🏷 Haggling Day: ${g.mods.priceDiscount} Silver off everything</div>` : '';
  return `<div class="screen vendor">
    <h2>🧺 Herb Market</h2>
    <div class="wallet"><span class="a">${me.budget}🪙</span> Silver · <span>${me.purchases.length}/2 bought</span> · <span>${me.coffee}💎</span></div>
    <div class="muted small">Two different ingredients max. Silver you don't spend tonight is gone tomorrow. Use it or lose it!</div>
    ${sale}
    <div class="shop">${rows}</div>
    <div class="coffee-actions">
      <button class="ghost" data-act="recharge" ${me.rollbackCharged || me.coffee < ROLLBACK_RECHARGE_COST ? 'disabled' : ''}>🥄 Restore your Ladle (${ROLLBACK_RECHARGE_COST}💎)${me.rollbackCharged ? ' · ready' : ''}</button>
      <button class="ghost" data-act="improve" ${me.coffee < PROCESS_IMPROVEMENT_COST ? 'disabled' : ''}>🔥 Stoke the fire: start +1 space for good (${PROCESS_IMPROVEMENT_COST}💎) · now ${me.startPos}</button>
    </div>
    <button class="big" data-act="vendor-done">DONE SHOPPING ✔</button>
  </div>`;
}

function leaderboard(g: Game): string {
  return `<div class="plb">${standings(g)
    .map((p, i) => `<div><span class="muted">#${i + 1}</span> ${avatarBadge(p, 0.8)} ${esc(p.name)} <b>${p.up}★</b></div>`)
    .join('')}</div>`;
}

function finalScreen(g: Game, me: Player): string {
  const s = standings(g);
  const rank = s.findIndex((p) => p.seat === me.seat) + 1;
  return `<div class="screen center">
    <div class="boom">${rank === 1 ? '🏆' : rank <= 3 ? '🎖️' : '📋'}</div>
    <h1>${rank === 1 ? 'GRAND ALCHEMIST' : `#${rank} of ${s.length}`}</h1>
    <p><b>${me.up} Renown ★</b></p>
    <div class="lines">${(me.summary?.lines ?? []).map((l) => `<div>${esc(l)}</div>`).join('')}</div>
    ${leaderboard(g)}</div>`;
}

function spectator(g: Game): string {
  return `<div class="screen center"><div class="logo">BRIMSTONE <span>&amp;</span> BREW</div>
    <h2>👀 Spectator mode</h2>
    ${g.phase === 'lobby' ? `<p class="muted">The game hasn't started yet.</p><button class="big" data-act="rejoin">JOIN AS ${esc(form.name || '…')}</button>` : `<p class="muted">The fair already started. You're watching night ${g.round}/${ROUNDS}.</p>`}
    ${leaderboard(g)}
    <button class="ghost" data-act="leave">Back</button></div>`;
}

// Auto-rejoin after a refresh or sleep if we were in a room.
const urlCode = new URLSearchParams(location.search).get('code');
const last = LS.get('patch-tuesday-last-room');
if (last && isRoomCode(last) && (!urlCode || normalizeRoomCode(urlCode) === last) && LS.get(`patch-tuesday-token-${last}`)) {
  connect(last, false);
} else {
  draw();
}
