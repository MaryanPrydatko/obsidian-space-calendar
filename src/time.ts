// Day and Week, in either direction: time Across (left to right) or Down (top to bottom). Space's cal-time.js.
// A time box holds a stretch of hours along one axis and lanes across the other, so nothing covers anything.
import type { SpaceCalendarView as V } from './view';
import type { Item } from './types';
import { addDays, day0, el, hm, iso, sameDay } from './util';
import * as E from './edit';

export const touch = (): boolean => window.matchMedia('(pointer: coarse)').matches; // a finger scrolls; it double-taps to make one

/** Hours to show: the day's things, today's now, and at least 8 hours. */
function hours(timed: Item[], days: Date[]): [number, number] {
  let lo = 7, hi = 22;
  timed.forEach((it) => { lo = Math.min(lo, it.start.getHours()); hi = Math.max(hi, it.end.getHours() + (it.end.getMinutes() ? 1 : 0) + (sameDay(it.start, it.end) ? 0 : 24)); });
  const now = new Date(); if (days.some((d) => sameDay(d, now))) { lo = Math.min(lo, now.getHours()); hi = Math.max(hi, now.getHours() + 1); }
  return [Math.max(0, lo), Math.min(24, Math.max(hi, lo + 8))];
}

let barW = -1;
/** How wide this system's scroll bar is (0 where it floats over the content, as on a Mac); measured once. */
function scrollBarW(): number { if (barW < 0) { const d = el('div'); d.style.cssText = 'position:absolute;top:-99px;width:50px;height:50px;overflow:scroll'; document.body.append(d); barW = d.offsetWidth - d.clientWidth; d.remove(); } return barW; }

export interface BoxOpts { list: Item[]; day: Date; h0: number; h1: number; along: 'x' | 'y'; scale: number; lane?: number; gap: number; minPx: number; width?: number; editable?: boolean; plan?: boolean; lanes?: number }

/** A time box. Down: overlapping things share the width of their own group, and stretch into lanes free beside them.
 *  Across: lanes are rows, the box as tall as the busiest hour needs. */
export function box(C: V, o: BoxOpts): HTMLElement {
  const min = (o.minPx / o.scale) * 3600e3, len = (o.h1 - o.h0) * o.scale, gap = o.gap, laneH = o.lane || 0;
  const n = !o.list.length ? 1 : o.lanes || (o.along === 'y' ? C.layout(o.list, min) : C.pack(o.list, min));
  const b = el('div', 'tbox' + (o.plan ? ' plan' : '')); b.dataset.along = o.along; b.dataset.day = iso(o.day); (b as any)._o = o;
  b.style.cssText = o.along === 'x' ? `position:relative;width:${len}px;height:${n * (laneH + gap)}px` : `position:relative;height:${len}px;width:${o.width}px`;
  const pos = (d: Date) => { const h = sameDay(d, o.day) ? d.getHours() + d.getMinutes() / 60 : d < o.day ? 0 : 24; return (Math.max(o.h0, Math.min(o.h1, h)) - o.h0) * o.scale; };
  o.list.forEach((it) => {
    // Down: at least minPx tall, with a 2 px gap to the next when there is room
    const a = pos(it.start), z = o.along === 'y' ? Math.max(a + o.minPx, pos(it.end) - 2) : Math.max(a + o.minPx, pos(it.end)) - 4, k = it.lane || 0;
    let left = 0, wide = 0;
    if (o.along === 'y') { const nl = it.lanes || n, lw = Math.max(30, ((o.width || 0) - (nl - 1) * gap) / nl); left = k * (lw + gap); wide = (it.span || 1) * lw + ((it.span || 1) - 1) * gap; }
    const across = o.along === 'x' ? z - a : wide;
    // the time line, whole: the start alone when narrow, start and end when there is no room for the calendar's name too
    const noTime = o.along === 'x' && across < 100, e = C.block(it, noTime ? false : across < 100 ? hm(it.start) : across < 170 ? C.timeLine(it) : '');
    if (o.along === 'x') e.style.cssText += `;left:${a}px;top:${k * (laneH + gap)}px;width:${z - a}px;height:${laneH}px`;
    else e.style.cssText += `;top:${a}px;left:${left}px;height:${z - a}px;width:${wide}px`;
    if (across < 90) e.classList.add('narrow');
    // whole lines only: as many title lines as the block's height holds
    const hgt = o.along === 'x' ? laneH : z - a, lines = Math.max(1, Math.floor((hgt - (o.along === 'y' ? 10 : 12)) / 16.5));
    if (lines < 2) e.classList.add('short'); e.style.setProperty('--tl', String(noTime ? Math.min(6, lines) : lines < 2 ? 1 : Math.min(6, lines - 1)));
    if (it.kind === 'card') E.cardDrag(C, e, it);
    b.append(e);
  });
  if (o.editable) E.box(C, b, o);
  return b;
}

function nowLine(host: HTMLElement, along: 'x' | 'y', at: number, label: boolean): void {
  const l = el('div', 'now-line ' + along); if (label) l.dataset.t = hm(new Date());
  l.style[along === 'x' ? 'left' : 'top'] = at + 'px'; host.append(l);
}
function ruler(along: 'x' | 'y', h0: number, h1: number, scale: number, offset: number, every: number): HTMLElement {
  const r = el('div', 'ruler ' + along);
  for (let h = h0; h <= h1; h += every) { const s = el('span', null, String(h).padStart(2, '0') + (along === 'x' && scale > 70 ? ':00' : '')); s.style[along === 'x' ? 'left' : 'top'] = offset + (h - h0) * scale + 'px'; r.append(s); }
  return r;
}
/** Sets a scroll position now and again on the next frame (a hidden pane may not run frames). */
function scrollTo(sc: HTMLElement, k: 'scrollLeft' | 'scrollTop', v: number): void { sc[k] = v; requestAnimationFrame(() => { sc[k] = v; }); }

// ---------- energy on a usual day: a morning peak, an afternoon dip, a second wind (Space's My plan) ----------
function energy(m: number): number {
  const g = (c: number, w: number) => Math.exp(-0.5 * Math.pow((m - c) / w, 2)), wake = Math.max(0, Math.min(1, (m - 435) / 100));
  return Math.max(0, Math.min(1, (0.22 + 0.62 * g(630, 130) + 0.5 * g(1080, 120) - 0.12 * g(870, 60)) * (0.25 + 0.75 * wake)));
}
function energyBand(h0: number, h1: number, scale: number): HTMLElement {
  const w = (h1 - h0) * scale, h = 44, pts: string[] = [], NS = 'http://www.w3.org/2000/svg';
  for (let m = h0 * 60; m <= h1 * 60; m += 10) pts.push(((m / 60 - h0) * scale).toFixed(1) + ',' + (h - 6 - energy(m) * (h - 14)).toFixed(1));
  const d = el('div', 'energy'); d.style.width = w + 'px';
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('width', String(w)); svg.setAttribute('height', String(h)); svg.setAttribute('aria-label', 'Energy on a usual day');
  const path = document.createElementNS(NS, 'path'); path.setAttribute('d', 'M' + pts.join(' L')); svg.append(path);
  ([[630, 'Peak'], [870, 'Dip'], [1080, 'Second wind']] as [number, string][]).forEach(([m, t]) => {
    if (m / 60 < h0 || m / 60 > h1) return;
    const tx = document.createElementNS(NS, 'text'); tx.setAttribute('x', ((m / 60 - h0) * scale).toFixed(0)); tx.setAttribute('y', (h - 10 - energy(m) * (h - 14)).toFixed(0)); tx.textContent = t; svg.append(tx);
  });
  d.append(svg); return d;
}

// ---------- the cards waiting at the top of the day: slipped, and that day without a time ----------
function waiting(C: V, d: Date, untimed: Item[]): HTMLElement | null {
  const today = day0(new Date()), isToday = sameDay(d, today);
  const slipped = isToday ? C.plugin.kanban.cards().filter((c) => !c.done && c.date < iso(today)).sort((a, b) => b.date.localeCompare(a.date)) : [];
  const open = untimed.filter((it) => it.kind === 'card' && !it.done);
  if (!slipped.length && !open.length) return null;
  const boxEl = el('div', 'waiting');
  const group = (name: string, n: number) => { const g = el('div', 'wgroup'); g.append(el('span', 'wname', name + ' ' + n)); boxEl.append(g); return g; };
  if (slipped.length) {
    const g = group('Slipped', slipped.length);
    slipped.slice(0, 30).forEach((c) => {
      const it = C.byId('k:' + c.path + ':' + c.line) || { id: 'k:' + c.path + ':' + c.line, title: c.title, start: new Date(c.date + 'T00:00:00'), end: addDays(new Date(c.date + 'T00:00:00'), 1), allDay: true, color: '', kind: 'card' as const, src: 'kanban' as const, card: c, calName: c.path.replace(/^.*\//, '').replace(/\.md$/, '') };
      g.append(wchip(C, it, true));
    });
  }
  if (open.length) { const g = group(isToday ? 'Today, any time' : 'That day, any time', open.length); open.forEach((it) => g.append(wchip(C, it, false))); }
  return boxEl;
}
function wchip(C: V, it: Item, late: boolean): HTMLElement {
  const c = it.card!, chip = el('div', 'wchip' + (late ? ' late' : '')); chip.style.setProperty('--c', it.color || C.plugin.colorOf(c.path));
  const tick = el('button', 'wtick'); tick.type = 'button'; tick.title = 'Done: tick it on its board'; tick.setAttribute('aria-label', 'Done');
  tick.onclick = (e) => { e.stopPropagation(); void E.tickCard(C, it); };
  chip.append(tick, el('span', 'wt', it.title));
  chip.append(el('span', 'we', late ? new Date(c.date + 'T12:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : it.calName || ''));
  if (late) {
    const add = el('button', 'wadd', 'Today'); add.type = 'button'; add.title = 'Move it to today (its date on the board changes)';
    add.onclick = (e) => { e.stopPropagation(); void E.moveCard(C, it, iso(new Date())); };
    chip.append(add);
  }
  chip.tabIndex = 0; chip.setAttribute('role', 'button'); chip.title = it.title + ' (' + (it.calName || '') + '). Click to open its board.';
  chip.onclick = () => { if (C.clickOk()) C.openCard(it); };
  chip.onkeydown = (k) => { if (k.key === 'Enter') C.openCard(it); };
  return chip;
}

// ---------- Day ----------
export function day(C: V, main: HTMLElement): void {
  const sc = el('div', 'scroll'), wrap = el('div', 'day ' + C.orient); sc.append(wrap); main.append(sc);
  const d = C.focus, its = C.items.filter((it) => it.start < addDays(d, 1) && it.end > d), all = its.filter((it) => it.allDay), timed = its.filter((it) => !it.allDay);
  const [h0, h1] = hours(timed, [d]), ev = timed.filter((it) => it.kind === 'event'), notes = timed.filter((it) => it.kind === 'card');
  // all-day items and the cards waiting to be placed sit above the hours, not in what scrolls
  const top = el('div', 'daytop');
  const wait = waiting(C, d, all), allRow = all.filter((it) => it.kind !== 'card' || it.done || !wait);
  const dm = C.dailyFor(d);
  if (allRow.length || dm) {
    const row = el('div', 'allday');
    if (dm) { const c = el('button', 'chip daily', 'Daily note'); c.type = 'button'; c.onclick = () => C.openFile(dm); row.append(c); }
    allRow.forEach((it) => row.append(C.chip(it))); top.append(row);
  }
  if (wait) top.append(wait);
  if (top.childNodes.length) main.insertBefore(top, sc);
  const now = new Date(), today = sameDay(d, now), nowH = now.getHours() + now.getMinutes() / 60, phone = C.W < 640, t = touch();
  const g = C.plugin.google.connected();
  if (C.orient === 'x') {
    // Across: hours left to right; the calendar band, then my plan; lanes grow to fill the height
    const H = Math.round((phone ? 96 : 132) * C.hz), avail = Math.max(260, main.clientHeight - (all.length ? 120 : 80));
    const nEv = ev.length ? C.pack(ev.slice(), (124 / H) * 3600e3) : 1, nNo = notes.length ? C.pack(notes.slice(), (124 / H) * 3600e3) : 1;
    const LH = Math.max(64, Math.min(116, Math.floor((avail - 60) / (nEv + nNo + 0.6) - 10)));
    const body = el('div', 'tl x'); wrap.append(body);
    body.append(ruler('x', h0, h1, H, 0, 1));
    body.append(energyBand(h0, h1, H));
    const lab = (txt: string, hint?: string) => { const l = el('div', 'band-label', txt); if (hint) l.append(el('span', 'hint', hint)); body.append(l); };
    lab('Calendar', g ? (t ? 'double-tap' : 'double-click or drag across') + ' empty time for a Google event' : '');
    body.append(box(C, { list: ev, day: d, h0, h1, along: 'x', scale: H, lane: LH, gap: 8, minPx: 124, editable: true }));
    lab('My plan', 'cards from your boards; click one to open its board');
    body.append(box(C, { list: notes, day: d, h0, h1, along: 'x', scale: H, lane: Math.min(LH, 84), gap: 8, minPx: 124, editable: true, plan: true }));
    for (let h = h0; h <= h1; h++) { const gl = el('div', 'grid-line x'); gl.style.left = (h - h0) * H + 'px'; body.append(gl); }
    if (today && nowH >= h0 && nowH < h1) { nowLine(body, 'x', (nowH - h0) * H, true); scrollTo(sc, 'scrollLeft', Math.max(0, (nowH - h0) * H - 140)); }
    else { const f = timed.slice().sort((a, b) => +a.start - +b.start)[0]; if (f) scrollTo(sc, 'scrollLeft', Math.max(0, (f.start.getHours() - h0) * H - 40)); }
  } else {
    // Down: hours top to bottom; the calendar on the left, my plan beside it
    const H = Math.round(Math.max(56, Math.min(84, Math.floor((main.clientHeight - 120) / 11))) * C.hz), Wd = Math.max(280, main.clientWidth - 40 - 56), wEv = Math.round(Wd * 0.6), wNo = Wd - wEv - 12;
    const body = el('div', 'tl y'); body.style.cssText = `position:relative;padding-left:56px;height:${(h1 - h0) * H + 30}px`; wrap.append(body);
    const heads = el('div', 'col-heads'); heads.style.cssText = 'padding-left:56px;display:flex;gap:12px'; const hd = (txt: string, w: number) => { const s = el('div', 'band-label', txt); s.style.width = w + 'px'; heads.append(s); };
    hd('Calendar', wEv); hd('My plan', wNo); wrap.insertBefore(heads, body);
    body.append(ruler('y', h0, h1, H, 0, 1));
    for (let h = h0; h <= h1; h++) { const gl = el('div', 'grid-line y'); gl.style.top = (h - h0) * H + 'px'; body.append(gl); }
    const row = el('div'); row.style.cssText = 'display:flex;gap:12px;position:relative'; body.append(row);
    row.append(box(C, { list: ev, day: d, h0, h1, along: 'y', scale: H, width: wEv, gap: 6, minPx: t ? 44 : 40, editable: true }));
    row.append(box(C, { list: notes, day: d, h0, h1, along: 'y', scale: H, width: wNo, gap: 6, minPx: t ? 44 : 40, editable: true, plan: true }));
    if (today && nowH >= h0 && nowH < h1) { nowLine(body, 'y', (nowH - h0) * H, true); scrollTo(sc, 'scrollTop', Math.max(0, (nowH - h0) * H - 120)); }
  }
}

// ---------- Week ----------
export function week(C: V, main: HTMLElement): void {
  const sc = el('div', 'scroll'), wrap = el('div', 'week ' + C.orient); sc.append(wrap); main.append(sc);
  const m = C.wkStart(C.focus), days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(m, i)), now = new Date(), nowH = now.getHours() + now.getMinutes() / 60, t = touch();
  const [h0, h1] = hours(C.items.filter((it) => !it.allDay), days);
  const dayItems = (d: Date) => C.items.filter((it) => it.start < addDays(d, 1) && it.end > d);
  const label = (d: Date) => {
    const l = el('button', 'wk-day'); l.type = 'button'; l.append(el('b', null, d.toLocaleDateString('en-GB', { weekday: 'short' })), el('small', null, d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })));
    l.onclick = () => C.openDay(d);
    const dm = C.dailyMark(d); if (dm) l.append(dm);
    return l;
  };
  if (C.orient === 'x') {
    const LEFT = 100, H = Math.round(Math.max(C.W < 640 ? 52 : 46, Math.floor((Math.max(600, main.clientWidth - 40) - LEFT) / (h1 - h0))) * C.hz);
    const head = ruler('x', h0, h1, H, LEFT, H < 60 ? 2 : 1); head.classList.add('sticky'); wrap.append(head);
    // Across: the seven days share the pane's height, so the whole week shows at once
    const rowH = Math.max(t ? 76 : 56, Math.floor((C.root.getBoundingClientRect().bottom - sc.getBoundingClientRect().top - head.getBoundingClientRect().height - 6) / 7));
    days.forEach((d) => {
      const its = dayItems(d), all = its.filter((it) => it.allDay), timed = its.filter((it) => !it.allDay);
      const row = el('div', 'wk-row' + (sameDay(d, now) ? ' today' : '')); row.dataset.day = iso(d); row.append(label(d)); row.style.minHeight = rowH + 'px';
      const inner = el('div', 'wk-inner'); inner.style.paddingLeft = LEFT + 'px';
      if (all.length) { const line = el('div', 'wk-alld'); all.slice(0, all.length > 4 ? 3 : 4).forEach((it) => line.append(C.chip(it))); if (all.length > 4) { const more = el('button', 'more', '+' + (all.length - 3) + ' more'); more.type = 'button'; more.onclick = () => C.openDay(d); line.append(more); } inner.append(line); }
      const n = timed.length ? C.pack(timed.slice(), (84 / H) * 3600e3) : 1, room = rowH - (all.length ? 31 : 0) - 15, lane = Math.max(t ? 44 : 28, Math.min(64, Math.floor((room - (n - 1) * 6) / n)));
      const bx = box(C, { list: timed, day: d, h0, h1, along: 'x', scale: H, lane, gap: 6, minPx: 84, editable: true }); bx.style.minHeight = (timed.length ? lane : 20) + 'px'; inner.append(bx);
      if (sameDay(d, now) && nowH >= h0 && nowH < h1) nowLine(bx, 'x', (nowH - h0) * H, false);
      row.append(inner); wrap.append(row);
    });
  } else {
    // Down: the seven days fill the width (a day whose overlaps need more room gets it, the others share what is left);
    // the hour ruler stays at the left
    const phone = C.W < 640, LEFT = phone ? 40 : 48, GAP = phone ? 4 : 6, side = phone ? 12 : 20;
    const mainW = main.clientWidth, H = Math.round(Math.max(44, Math.min(64, Math.floor((main.clientHeight - 150) / 12))) * C.hz), minPx = t ? 44 : 30;
    // all day: all-day events, cards without a time, and anything a day long or longer, as bars across their days
    const long = (it: Item) => it.allDay || +it.end - +it.start >= 864e5;
    const lists = days.map((d) => dayItems(d).filter((it) => !long(it))), lanes = lists.map((l) => (l.length ? C.layout(l, (minPx / H) * 3600e3) : 1));
    sc.style.scrollbarGutter = 'stable';
    const MINLANE = phone ? 76 : 72, avail = mainW - scrollBarW() - side * 2 - LEFT - GAP * 6, need = lanes.map((n) => n * MINLANE + (n - 1) * 3);
    let colWs: number[];
    if (phone) { const base = Math.floor((C.W - side * 2 - LEFT - GAP) / 2); colWs = need.map((n) => Math.max(base, n)); }
    else {
      const fixed = need.map(() => false); let share = avail / 7;
      for (let k = 0; k < 7; k++) { let fx = 0, nf = 0; need.forEach((n, i) => { if (fixed[i]) fx += n; else nf++; }); share = nf ? (avail - fx) / nf : 0; let more = false; need.forEach((n, i) => { if (!fixed[i] && n > share) { fixed[i] = more = true; } }); if (!more) break; }
      colWs = need.map((n, i) => (fixed[i] ? n : Math.max(share, 96)));
      const sum = colWs.reduce((x, y) => x + y, 0);
      // a week busier than the pane: every day gives alike, so the week still fits
      if (sum > avail) {
        const base = colWs; let k = avail / sum;
        for (let q = 0; q < 7; q++) { const pinned = base.filter((w) => w * k < 90).length, rest = base.filter((w) => w * k >= 90).reduce((x, y) => x + y, 0); if (!rest) break; const k2 = (avail - pinned * 90) / rest; if (Math.abs(k2 - k) < 1e-6) break; k = k2; }
        colWs = base.map((w) => Math.max(90, w * k));
      }
      colWs = colWs.map((w) => Math.floor(w));
    }
    const colX = colWs.map((_, i) => colWs.slice(0, i).reduce((x, y) => x + y, 0) + i * GAP), totalW = colX[6] + colWs[6];
    // the all-day strip grows only as far as it needs (at most three rows); what does not fit is "+N more", which opens the day
    const ROW = phone ? 44 : 24, CAP = phone ? 2 : 3, m0 = +m;
    const dayIdx = (d: Date) => Math.round((+day0(d) - m0) / 864e5);
    const bars = C.items.filter((it) => long(it) && it.start < addDays(m, 7) && it.end > m).map((it) => ({ it, s: Math.max(0, dayIdx(it.start)), e: Math.min(7, dayIdx(new Date(+it.end - 1)) + 1), row: 0 }))
      .sort((p, q) => p.s - q.s || (q.e - q.s) - (p.e - p.s) || (+!!p.it.done - +!!q.it.done) || (p.it.kind === 'card' ? 1 : 0) - (q.it.kind === 'card' ? 1 : 0));
    const rowEnd: number[] = [];
    bars.forEach((x) => { let r = rowEnd.findIndex((e) => e <= x.s); if (r < 0) { r = rowEnd.length; rowEnd.push(0); } rowEnd[r] = x.e; x.row = r; });
    const shownRows = rowEnd.length <= CAP ? rowEnd.length : CAP - 1, hidden = days.map((_, i) => bars.filter((x) => x.row >= shownRows && x.s <= i && x.e > i).length);
    const stripRows = shownRows + (hidden.some(Boolean) ? 1 : 0), LABEL = 46;
    const heads = el('div', 'wk-heads'); heads.style.cssText = `gap:${GAP}px;width:${LEFT + totalW}px`;
    const corner = el('div', 'wk-corner'); corner.style.width = LEFT - GAP + 'px'; heads.append(corner);
    days.forEach((d, i) => {
      const h = el('div', 'wk-head' + (sameDay(d, now) ? ' today' : '')); h.dataset.day = iso(d); h.style.width = colWs[i] + 'px'; h.append(label(d));
      const cell = el('div', 'wk-cell'); cell.style.height = stripRows * ROW + 'px'; h.append(cell);
      if (hidden[i]) { const more = el('button', 'chip more', '+' + hidden[i] + ' more'); more.type = 'button'; more.style.top = shownRows * ROW + 'px'; more.title = 'Open ' + d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }); more.onclick = () => C.openDay(d); cell.append(more); }
      heads.append(h);
    });
    bars.filter((x) => x.row < shownRows).forEach((x) => {
      const it = x.it, bt = el('button', 'wbar' + (it.kind === 'card' ? ' note' : '') + (it.done ? ' done' : '') + (dayIdx(it.start) < 0 ? ' from-before' : '') + (dayIdx(new Date(+it.end - 1)) > 6 ? ' on-after' : ''));
      bt.type = 'button'; bt.dataset.id = it.id; bt.style.setProperty('--c', it.color); bt.style.cssText += `;left:${LEFT + colX[x.s]}px;top:${LABEL + x.row * ROW}px;width:${colX[x.e - 1] + colWs[x.e - 1] - colX[x.s]}px;height:${ROW}px`;
      bt.append(el('span', 'wb', (it.allDay ? '' : hm(it.start) + ' ') + it.title)); bt.title = it.title + (it.calName ? ' (' + it.calName + ')' : '');
      bt.onclick = (e: MouseEvent) => { if (C.clickOk()) C.detail(it, e); };
      if (it.kind === 'card') E.cardDrag(C, bt, it); else E.bar(C, bt, it); // drag it to other days
      heads.append(bt);
    });
    wrap.append(heads);
    const body = el('div', 'wk-body'); body.style.cssText = `gap:${GAP}px;height:${(h1 - h0) * H + 20}px;width:${LEFT + totalW}px`; wrap.append(body);
    const rul = ruler('y', h0, h1, H, 0, 1); rul.classList.add('wk-rul'); rul.style.width = LEFT - GAP + 'px'; body.append(rul);
    for (let h = h0; h <= h1; h++) { const gl = el('div', 'grid-line y'); gl.style.top = (h - h0) * H + 'px'; gl.style.left = LEFT + 'px'; body.append(gl); }
    const cols = el('div', 'wk-cols'); cols.style.gap = GAP + 'px'; body.append(cols);
    days.forEach((d, i) => {
      // laid out above already; a day with a thing that runs on past midnight is laid out again
      const l = lists[i], twice = i < 6 && l.some((it) => it.end > days[i + 1]), bx = box(C, { list: l, lanes: twice ? 0 : lanes[i], day: d, h0, h1, along: 'y', scale: H, width: colWs[i], gap: 3, minPx, editable: true });
      if (sameDay(d, now)) { bx.classList.add('today'); if (nowH >= h0 && nowH < h1) nowLine(bx, 'y', (nowH - h0) * H, false); }
      cols.append(bx);
    });
    if (phone) { sc.classList.add('by-day'); sc.style.scrollPaddingLeft = LEFT + 'px'; }
    if (nowH >= h0 && nowH < h1) scrollTo(sc, 'scrollTop', Math.max(0, (nowH - h0) * H - 100));
  }
}
