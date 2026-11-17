import morphdom from 'morphdom';
import { CHANGES, avatarById } from '../engine/data';
import type { Change, Player } from '../engine/types';

/** Escape user-provided text before putting it in HTML. */
export function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Re-render a container while keeping DOM nodes (so CSS transitions play). */
export function render(el: HTMLElement, html: string) {
  const next = el.cloneNode(false) as HTMLElement;
  next.innerHTML = html;
  morphdom(el, next, {
    onBeforeElUpdated(from, to) {
      if (from.isEqualNode(to)) return false;
      // Keep focused inputs as the user is typing.
      if (from === document.activeElement && (from.tagName === 'INPUT' || from.tagName === 'SELECT')) return false;
      return true;
    },
  });
}

export function avatarBadge(p: Pick<Player, 'avatar'>, size = 1): string {
  const a = avatarById(p.avatar);
  return `<span class="avatar" style="--c:${a.color};--s:${size}" title="${esc(a.name)}">${a.emoji}</span>`;
}

export function chipHtml(c: Pick<Change, 'type' | 'value'>, extra = ''): string {
  const d = CHANGES[c.type];
  return `<span class="chip chip-${c.type} ${extra}" style="--chip:${d.color}" title="${esc(d.name)}"><b>${c.value}</b><i>${d.emoji}</i></span>`;
}

export function countsByType(changes: Change[]): Array<{ type: Change['type']; value: number; n: number }> {
  const m = new Map<string, { type: Change['type']; value: number; n: number }>();
  for (const c of changes) {
    const k = `${c.type}:${c.value}`;
    const e = m.get(k) ?? { type: c.type, value: c.value, n: 0 };
    e.n++;
    m.set(k, e);
  }
  const order = Object.keys(CHANGES);
  return [...m.values()].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.value - b.value);
}

/** Bug gauge level 0..1 with a CPU-temperature style color. */
export function gaugeColor(ratio: number): string {
  if (ratio >= 0.85) return 'var(--red)';
  if (ratio >= 0.6) return 'var(--amber)';
  return 'var(--green)';
}
