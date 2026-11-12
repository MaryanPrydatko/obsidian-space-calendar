// Changing the calendar (Space's cal-edit.js):
// - a card: drag it to another day (Week, Month, the all-day strip); only its `@{date}` on its board changes, with Undo;
// - a Google event on a calendar you can write: drag empty time to make one (double-click for an hour), drag it to another
//   time or day, drag its end or start to stretch it, Alt (Option) drag to copy it, drag it into the all-day strip (Week,
//   Down) to make it all day, click it for the editor, arrow keys move the one you picked, Delete twice deletes it;
// - Cmd+Z takes back the last change made here, Esc closes what is open.
// A repeating Google event changes only the one day you changed (the instance), never the whole series.
import type { SpaceCalendarView as V } from './view';
import type { BoxOpts } from './time';
import type { GFields, Item } from './types';
import { GoogleError, COLORS, type GCal } from './sources/google';
import { dayShort, daysBetween, el, fromIso, hm, iso, sameDay, shiftDays } from './util';

const SNAP = 15 * 60e3;

// ---------- cards: drag to another day ----------
/** Moves a card to another day on its board, with Undo. */
export async function moveCard(C: V, it: Item, to: string): Promise<void> {
  const card = it.card; if (!card || card.date === to) return;
  const from = card.date, now = await C.plugin.kanban.reschedule(card, to);
  if (!now) return;
  C.toast('Moved "' + it.title + '" to ' + dayShort(fromIso(to)), () => {
    void C.plugin.kanban.reschedule(now, from).then((back) => { if (back) C.toast('Back on ' + dayShort(fromIso(from))); });
  });
}
/** Ticks a card on its board (only its `- [ ]` changes), with Undo. */
export async function tickCard(C: V, it: Item): Promise<void> {
  const card = it.card; if (!card || card.done) return;
  try { await C.plugin.kanban.setDone(card, true); } catch (e) { C.toast('Not ticked: ' + (e instanceof Error ? e.message : String(e))); return; }
  const raw = card.raw.replace(/^- \[ \]/, '- [x]');
  C.toast('Ticked "' + it.title + '"', () => {
    const now = C.plugin.kanban.cards().find((c) => c.path === card.path && c.raw === raw);
    if (now) void C.plugin.kanban.setDone(now, false).then(() => C.toast('Open again'), () => C.toast('That card changed meanwhile, so it stays ticked.'));
  });
}
/** A card follows the pointer; let go over another day (a day column, a row of the week, a cell of the month) and it moves there. */
export function cardDrag(C: V, node: HTMLElement, it: Item): void {
  node.classList.add('can-move');
  node.addEventListener('pointerdown', (ev) => {
    const e = ev as PointerEvent; if (e.button !== 0 || (e.target as HTMLElement).closest('.daily-mark, .wadd')) return;
    e.stopPropagation(); // not the box's own drag (which makes an event)
    const doc = node.ownerDocument, x0 = e.clientX, y0 = e.clientY; let ghost: HTMLElement | null = null, over: HTMLElement | null = null;
    const dayAt = (x: number, y: number): HTMLElement | null => {
      for (const n of doc.elementsFromPoint(x, y)) { const h = (n as HTMLElement).closest?.('[data-day]') as HTMLElement | null; if (h && C.main.contains(h)) return h; }
      return null;
    };
    const mv = (e2: PointerEvent) => {
      if (!ghost && Math.hypot(e2.clientX - x0, e2.clientY - y0) < 6) return;
      if (!ghost) {
        ghost = el('div', 'card-ghost', it.title); ghost.style.setProperty('--c', it.color); C.root.append(ghost);
        node.classList.add('lifted');
      }
      const R = C.root.getBoundingClientRect();
      ghost.style.left = e2.clientX - R.left + 10 + 'px'; ghost.style.top = e2.clientY - R.top + 10 + 'px';
      const h = dayAt(e2.clientX, e2.clientY);
      if (h !== over) { over?.classList.remove('drop-on'); over = h; if (over && over.dataset.day !== it.card?.date) over.classList.add('drop-on'); }
      if (ghost) ghost.dataset.to = over?.dataset.day ? dayShort(fromIso(over.dataset.day)) : '';
    };
    const stop = () => { doc.removeEventListener('pointermove', mv); doc.removeEventListener('pointerup', up); doc.removeEventListener('keydown', esc, true); ghost?.remove(); over?.classList.remove('drop-on'); node.classList.remove('lifted'); };
    const up = (e2: PointerEvent) => {
      const moved = !!ghost, h = moved ? dayAt(e2.clientX, e2.clientY) : null; stop();
      if (!moved) return; C.suppressClick();
      const to = h?.dataset.day; if (to && it.card && to !== it.card.date) void moveCard(C, it, to);
    };
    const esc = (k: KeyboardEvent) => { if (k.key === 'Escape' && ghost) { k.stopPropagation(); stop(); C.suppressClick(); } };
    doc.addEventListener('pointermove', mv); doc.addEventListener('pointerup', up); doc.addEventListener('keydown', esc, true);
  });
}

// ---------- Google: changes, shown at once, rolled back when Google says no ----------
function failed(C: V, e: unknown): void {
  const s = e instanceof GoogleError ? e.status : -1;
  if (s === 412) { C.toast('This event changed in Google meanwhile. The calendar shows the latest now; make your change again if you still want it.'); C.plugin.google.refresh(); return; }
  if (s === 403) { C.toast('That calendar is read only.'); return; }
  if (s === 404 || s === 410) { C.toast('That event is no longer in Google. The calendar shows the latest now.'); C.plugin.google.refresh(); return; }
  if (s === 401) { C.toast('Google sign-in ended. Connect again in the plugin settings.'); return; }
  C.toast(s === 0 ? 'Could not reach Google. Nothing changed there yet.' : 'Google did not take the change. Nothing changed there yet.');
}
function inverse(it: Item, f: GFields): GFields {
  const g: GFields = {};
  if (f.title !== undefined) g.title = it.title;
  if (f.start) { g.start = it.start; g.end = it.end; g.allDay = it.allDay; }
  if (f.colorId !== undefined) g.colorId = it.g?.colorId || '';
  if (f.desc !== undefined) g.desc = it.desc || '';
  if (f.location !== undefined) g.location = it.location || '';
  return g;
}
export async function change(C: V, it: Item, f: GFields, o: { msg?: string; undoing?: boolean } = {}): Promise<void> {
  try {
    const cur = await C.plugin.google.patch(it, f);
    const msg = o.msg || (f.start && Object.keys(f).length <= 3 ? (f.allDay ? (sameDay(f.start, it.start) ? 'All day on ' : 'Moved to ') + dayShort(f.start) : sameDay(f.start, it.start) ? 'Now ' + hm(f.start) + ' to ' + hm(f.end!) : 'Moved to ' + dayShort(f.start) + ', ' + hm(f.start)) : 'Saved');
    if (o.undoing) { C.toast(msg); return; }
    C.toast(msg + (it.g?.rec ? ' (this day only)' : ''), () => { void change(C, cur, inverse(it, f), { msg: 'Undone', undoing: true }); });
  } catch (e) { C.draw(); failed(C, e); }
}
async function create(C: V, cal: string, f: GFields, o: { msg?: string; undoing?: boolean } = {}): Promise<void> {
  try {
    const made = await C.plugin.google.create(cal, f);
    if (o.undoing) { C.toast(o.msg || 'Back again'); return; }
    C.toast(o.msg || 'Added to ' + (made.calName || 'Google Calendar'), () => { void remove(C, made, true); });
  } catch (e) { failed(C, e); }
}
async function remove(C: V, it: Item, quiet = false): Promise<void> {
  try {
    await C.plugin.google.remove(it);
    if (quiet) { C.toast('Taken away again'); return; }
    // Undo makes it again from what the calendar showed (a new event with the same fields)
    C.toast('Deleted ' + it.title + (it.g?.rec ? ' (this day only)' : ''), () => { void create(C, it.g!.cal, { title: it.title, start: it.start, end: it.end, allDay: it.allDay, colorId: it.g?.colorId, desc: it.desc, location: it.location }, { undoing: true }); });
  } catch (e) { failed(C, e); }
}
async function duplicate(C: V, it: Item, s: Date, en: Date): Promise<void> {
  const cals = await C.plugin.google.writable(), mine = it.editable && it.g ? it.g.cal : C.plugin.google.defaultCal(cals)?.id;
  if (!mine) { C.toast('Connect Google Calendar in the plugin settings first.'); return; }
  void create(C, mine, { title: it.title, start: s, end: en, allDay: false, colorId: it.g?.colorId, desc: it.desc, location: it.location }, { msg: 'Copied to ' + dayShort(s) + ', ' + hm(s) });
}

// ---------- where a pointer is, in time ----------
interface Q { b: HTMLElement; o: BoxOpts; r: DOMRect }
function boxes(C: V, o: { plan?: boolean; along: string }): Q[] {
  return [...C.main.querySelectorAll<HTMLElement>('.tbox')].filter((b) => (b as any)._o && !!(b as any)._o.plan === !!o.plan && (b as any)._o.along === o.along)
    .map((b) => ({ b, o: (b as any)._o as BoxOpts, r: b.getBoundingClientRect() }));
}
function boxAt(bs: Q[], along: string, x: number, y: number): Q {
  const v = along === 'y' ? x : y; let best = bs[0], dist = Infinity;
  for (const q of bs) { const lo = along === 'y' ? q.r.left : q.r.top, hi = along === 'y' ? q.r.right : q.r.bottom, d = v < lo ? lo - v : v > hi ? v - hi : 0; if (d < dist) { dist = d; best = q; } }
  return best;
}
function timeIn(q: { o: BoxOpts; r: DOMRect }, x: number, y: number): Date {
  const px = q.o.along === 'x' ? x - q.r.left : y - q.r.top, ms = +q.o.day + (q.o.h0 + px / q.o.scale) * 3600e3;
  return new Date(Math.round(ms / SNAP) * SNAP);
}
function stripOf(C: V) {
  const h = C.main.querySelector<HTMLElement>('.wk-heads'); if (!h) return null;
  const r = h.getBoundingClientRect(), cells = [...h.querySelectorAll('.wk-head')].map((x) => { const xr = x.getBoundingClientRect(), c = x.querySelector('.wk-cell'), cr = c ? c.getBoundingClientRect() : xr; return { l: xr.left - r.left, w: xr.width, t: cr.top - r.top, h: Math.max(24, cr.height) }; });
  return cells.length === 7 ? { el: h, r, cells } : null;
}
const capture = (n: HTMLElement, id: number) => { try { n.setPointerCapture(id); } catch { /* a made-up pointer (a test) has no capture */ } };

/** Make a box editable: drag on empty space makes an event; drag an event moves or stretches it; Alt drag copies it. */
export function box(C: V, b: HTMLElement, o: BoxOpts): void {
  b.classList.add('editable');
  b.addEventListener('pointerdown', (ev) => {
    const e = ev as PointerEvent; if (e.button !== 0) return;
    const target = e.target as HTMLElement, blockEl = target.closest<HTMLElement>('.ev');
    if (blockEl) {
      const it = C.byId(blockEl.dataset.id || ''); if (!it || it.kind !== 'event' || !(it.editable || (e.altKey && C.plugin.google.connected()))) return;
      dragEvent(C, b, o, blockEl, it, e);
      return;
    }
    if (target !== b || e.pointerType === 'touch' || o.plan) return;
    makeEvent(C, b, o, e);
  });
  // the start edge of an event says it can be pulled; set on hover
  b.addEventListener('pointermove', (ev) => {
    const e = ev as PointerEvent; if (e.buttons || e.pointerType !== 'mouse') return;
    const t = (e.target as HTMLElement).closest<HTMLElement>('.ev.can-edit'); if (!t) return;
    const r = t.getBoundingClientRect(), d = o.along === 'x' ? e.clientX - r.left : e.clientY - r.top, c = d < 7 && (o.along === 'x' ? r.width : r.height) > 28 ? (o.along === 'x' ? 'ew-resize' : 'ns-resize') : '';
    if (t.style.cursor !== c) t.style.cursor = c;
  });
}

let lastClick = { t: 0, x: 0, y: 0 };
/** A click on empty time that closes an open form counts as the first click of a double click. */
export function noteClick(e: PointerEvent): void { lastClick = { t: Date.now(), x: e.clientX, y: e.clientY }; }
function makeEvent(C: V, b: HTMLElement, o: BoxOpts, e: PointerEvent): void {
  const bs = boxes(C, o), q0 = bs.find((q) => q.b === b) || { b, o, r: b.getBoundingClientRect() };
  const t0 = timeIn(q0, e.clientX, e.clientY); let t1 = new Date(+t0 + 60 * 60e3), moved = false;
  let ghosts: HTMLElement[] = [];
  // one ghost in each day the new event runs through
  const place = () => {
    ghosts.forEach((g) => g.remove()); ghosts = [];
    const a = new Date(Math.min(+t0, +t1)), z = new Date(Math.max(+t0, +t1, Math.min(+t0, +t1) + SNAP)), many = !sameDay(a, new Date(+z - 1));
    bs.filter((q) => +q.o.day + 864e5 > +a && +q.o.day < +z).forEach((q, i) => {
      const from = Math.max(+a, +q.o.day + q.o.h0 * 3600e3), to = Math.min(+z, +q.o.day + q.o.h1 * 3600e3), p = (t: number) => ((t - +q.o.day) / 3600e3 - q.o.h0) * q.o.scale;
      const g = el('div', 'ev ghost'); g.style.cssText = o.along === 'x' ? `left:${p(from)}px;top:0;width:${Math.max(4, p(to) - p(from))}px;height:${o.lane}px` : `top:${p(from)}px;left:0;height:${Math.max(4, p(to) - p(from))}px;width:${q.o.width}px`;
      if (i === 0) g.textContent = (many ? dayShort(a) + ' ' : '') + hm(a) + ' to ' + (many ? dayShort(z) + ' ' : '') + hm(z);
      q.b.append(g); ghosts.push(g);
    });
  };
  capture(b, e.pointerId);
  const mv = (e2: PointerEvent) => { const q = boxAt(bs, o.along, e2.clientX, e2.clientY) || q0, t = timeIn(q, e2.clientX, e2.clientY); if (Math.abs(+t - +t0) >= SNAP || q !== q0) moved = true; if (moved) { t1 = t; place(); } };
  const done = () => ghosts.forEach((g) => g.remove());
  const up = (e2: PointerEvent) => {
    b.removeEventListener('pointermove', mv); b.removeEventListener('pointerup', up);
    // a click that did not drag makes nothing, unless it is the second click of a double click
    if (!moved) { const now = Date.now(), dbl = now - lastClick.t < 400 && Math.hypot(e2.clientX - lastClick.x, e2.clientY - lastClick.y) < 12; lastClick = dbl ? { t: 0, x: 0, y: 0 } : { t: now, x: e2.clientX, y: e2.clientY }; if (!dbl) { done(); return; } }
    const a = new Date(Math.min(+t0, +t1)), z = moved ? new Date(Math.max(+t0, +t1, +a + SNAP)) : new Date(+t0 + 60 * 60e3);
    if (!C.plugin.google.connected()) { done(); C.toast('Connect Google Calendar in the plugin settings to make events here.'); return; }
    place(); editor(C, null, e2, { a, b: z, allDay: false, done });
  };
  b.addEventListener('pointermove', mv); b.addEventListener('pointerup', up);
}

/** Drag an event: by its middle to another time or day, by its end edge for when it ends, by its start edge for when it
 *  starts; with Alt, a copy moves and the event stays. Esc puts it back. */
function dragEvent(C: V, b: HTMLElement, o: BoxOpts, node: HTMLElement, it: Item, e: PointerEvent): void {
  const r = node.getBoundingClientRect(), along = o.along, len = along === 'x' ? r.width : r.height;
  const toEnd = along === 'x' ? r.right - e.clientX : r.bottom - e.clientY, fromStart = along === 'x' ? e.clientX - r.left : e.clientY - r.top;
  const copy = e.altKey, mode = copy || !it.editable ? 'move' : toEnd < 10 ? 'end' : fromStart < 7 && len > 28 ? 'start' : 'move';
  const bs = mode === 'move' ? boxes(C, o) : [], q0 = bs.find((q) => q.b === b);
  const strip = mode === 'move' && !copy && along === 'y' && bs.length === 7 ? stripOf(C) : null; // Week, Down: the all-day strip takes it as all day
  let sg: HTMLElement | null = null, inStrip = -1;
  const start0 = new Date(it.start), end0 = new Date(it.end), p0 = along === 'x' ? e.clientX : e.clientY, c0 = along === 'x' ? e.clientY : e.clientX, k = 3600e3 / o.scale;
  let dt = 0, dd = 0, moving = false, cancelled = false, q = q0, s = start0, en = end0, g: HTMLElement = node;
  capture(node, e.pointerId);
  const doc = node.ownerDocument;
  const mv = (e2: PointerEvent) => {
    if (cancelled) return;
    const d = (along === 'x' ? e2.clientX : e2.clientY) - p0, dc = (along === 'x' ? e2.clientY : e2.clientX) - c0;
    if (!moving && Math.abs(d) < 5 && Math.abs(dc) < 5) return;
    if (!moving) { moving = true; if (copy) { g = node.cloneNode(true) as HTMLElement; g.classList.add('copying'); node.after(g); } g.classList.add('dragging'); }
    dt = Math.round((d * k) / SNAP) * SNAP;
    if (mode === 'move' && q0 && bs.length > 1) { const qq = boxAt(bs, along, e2.clientX, e2.clientY) || q0; q = qq; dd = daysBetween(q0.o.day, qq.o.day); }
    if (strip) {
      const i = e2.clientY < strip.r.bottom && q ? bs.indexOf(q) : -1;
      if (i >= 0) {
        const sx = sg || (sg = el('div', 'ev ghost')); if (!sx.parentNode) { strip.el.append(sx); g.style.opacity = '0.35'; }
        if (i !== inStrip) { const c = strip.cells[i]; sx.style.cssText = `left:${c.l}px;top:${c.t}px;width:${c.w}px;height:${c.h}px;padding:2px 8px`; sx.textContent = 'All day, ' + dayShort(bs[i].o.day); }
        inStrip = i;
      } else if (sg) { sg.remove(); sg = null; inStrip = -1; g.style.opacity = ''; }
    }
    const px = dt / k, ox = q && q0 ? (along === 'y' ? q.r.left - q0.r.left : 0) : 0, oy = q && q0 ? (along === 'x' ? q.r.top - q0.r.top : 0) : 0;
    if (mode === 'end') { en = new Date(Math.max(+start0 + SNAP, +end0 + dt)); g.style[along === 'x' ? 'width' : 'height'] = Math.max(16, len + px) + 'px'; }
    else if (mode === 'start') { s = new Date(Math.min(+end0 - SNAP, +start0 + dt)); const sh = Math.min(px, len - 16); g.style.transform = along === 'x' ? `translateX(${sh}px)` : `translateY(${sh}px)`; g.style[along === 'x' ? 'width' : 'height'] = len - sh + 'px'; }
    else { s = new Date(+shiftDays(start0, dd) + dt); en = new Date(+shiftDays(end0, dd) + dt); g.style.transform = along === 'x' ? `translate(${px}px, ${oy}px)` : `translate(${ox}px, ${px}px)`; }
    const m = g.querySelector('.m'); if (m) m.textContent = (dd ? dayShort(s) + ', ' : '') + hm(s) + ' to ' + hm(en);
  };
  const esc = (k2: KeyboardEvent) => { if (k2.key !== 'Escape' || !moving) return; k2.stopPropagation(); cancelled = true; finish(); if (g !== node) g.remove(); C.draw(); };
  const finish = () => { doc.removeEventListener('pointermove', mv); doc.removeEventListener('pointerup', up); doc.removeEventListener('keydown', esc, true); g.classList.remove('dragging'); if (sg) { sg.remove(); sg = null; } };
  const up = (e2: PointerEvent) => {
    const toDay = inStrip >= 0 ? bs[inStrip].o.day : null;
    finish(); if (!moving || cancelled) return; C.suppressClick();
    if (toDay) { void change(C, it, { start: new Date(toDay), end: shiftDays(toDay, 1), allDay: true }); return; }
    if (+s === +start0 && +en === +end0) { if (g !== node) g.remove(); else C.draw(); return; }
    if (copy) { g.remove(); void duplicate(C, it, s, en); return; }
    void change(C, it, { start: s, end: en, allDay: false });
    void e2;
  };
  doc.addEventListener('pointermove', mv); doc.addEventListener('pointerup', up); doc.addEventListener('keydown', esc, true);
}

// ---------- an all-day Google bar in the week: drag it to other days, or down into the hours for an hour there ----------
export function bar(C: V, bt: HTMLElement, it: Item): void {
  if (!it.editable) return;
  bt.classList.add('can-edit');
  bt.addEventListener('pointerdown', (ev) => {
    const e = ev as PointerEvent; if (e.button !== 0) return;
    const cols = [...C.main.querySelectorAll('.week .tbox')].map((x) => x.getBoundingClientRect()); if (cols.length < 7) return;
    const x0 = e.clientX, y0 = e.clientY, at = (x: number) => { let i = 0; cols.forEach((c, j) => { if (x >= c.left) i = j; }); return i; }, i0 = at(x0);
    const hb = (bt.closest('.wk-heads') || bt).getBoundingClientRect().bottom, bs = boxes(C, { along: 'y' }), len = it.allDay ? 3600e3 : +it.end - +it.start;
    let dd = 0, moving = false, to: Date | null = null, gh: HTMLElement | null = null; capture(bt, e.pointerId);
    const doc = bt.ownerDocument;
    const mv = (e2: PointerEvent) => {
      if (!moving && Math.abs(e2.clientX - x0) < 6 && Math.abs(e2.clientY - y0) < 6) return; moving = true; bt.classList.add('dragging');
      if (e2.clientY > hb && bs.length === 7) {
        const q = boxAt(bs, 'y', e2.clientX, e2.clientY); to = timeIn(q, e2.clientX, e2.clientY);
        const gx = gh || (gh = el('div', 'ev ghost')); bt.style.transform = ''; bt.style.opacity = '0.35';
        if (gx.parentNode !== q.b) q.b.append(gx);
        const top = ((+to - +q.o.day) / 3600e3 - q.o.h0) * q.o.scale; gx.style.cssText = `top:${top}px;left:0;width:${q.o.width}px;height:${Math.max(16, (len / 3600e3) * q.o.scale)}px`; gx.textContent = hm(to) + ' to ' + hm(new Date(+to + len));
        return;
      }
      if (gh) { gh.remove(); gh = null; to = null; bt.style.opacity = ''; }
      dd = at(e2.clientX) - i0; bt.style.transform = `translateX(${cols[i0 + dd].left - cols[i0].left}px)`;
    };
    const up = () => {
      doc.removeEventListener('pointermove', mv); doc.removeEventListener('pointerup', up); bt.classList.remove('dragging'); if (gh) gh.remove(); if (!moving) return; C.suppressClick();
      if (to) { bt.style.opacity = ''; void change(C, it, { start: to, end: new Date(+to + len), allDay: false }); return; }
      if (!dd) { bt.style.transform = ''; return; }
      void change(C, it, { start: shiftDays(it.start, dd), end: shiftDays(it.end, dd), allDay: true });
    };
    doc.addEventListener('pointermove', mv); doc.addEventListener('pointerup', up);
  });
}

// ---------- keys: the Google event you picked ----------
let kb: { it: Item; el: HTMLElement; dt: number; dd: number; timer: number } | null = null; let armed = '', armedAt = 0;
function commitKeys(C: V): void {
  const x = kb; kb = null; if (!x || (!x.dt && !x.dd)) return;
  window.clearTimeout(x.timer); const it = x.it, s = new Date(+shiftDays(it.start, x.dd) + x.dt), en = new Date(+shiftDays(it.end, x.dd) + x.dt);
  C.refocus = true; void change(C, it, { start: s, end: en, allDay: false });
}
/** A key on a picked event. Returns true when it was used. */
export function key(C: V, node: HTMLElement, e: KeyboardEvent): boolean {
  const it = C.byId(node.dataset.id || ''), q = node.closest('.tbox') as any; if (!it || !q || !q._o || it.kind !== 'event') return false;
  const o: BoxOpts = q._o;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (!it.editable) { C.toast('That calendar is read only.'); return true; }
    if (armed !== it.id || Date.now() - armedAt > 4000) { armed = it.id; armedAt = Date.now(); C.toast('Press Delete again to delete "' + it.title + '".'); return true; }
    armed = ''; void remove(C, it); return true;
  }
  const time: Record<string, number> = o.along === 'y' ? { ArrowUp: -1, ArrowDown: 1 } : { ArrowLeft: -1, ArrowRight: 1 }, day: Record<string, number> = o.along === 'y' ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 };
  const dT = time[e.key], dD = day[e.key];
  if ((!dT && !dD) || !it.editable || e.metaKey || e.ctrlKey || e.altKey) return false;
  const bs = boxes(C, o), q0 = bs.find((x) => x.b === q);
  if (dD && bs.length < 2) return false; // Day: left and right still step the days
  if (kb && kb.it.id !== it.id) commitKeys(C);
  if (!kb) kb = { it, el: node, dt: 0, dd: 0, timer: 0 };
  kb.dt += (dT || 0) * SNAP; if (dD && q0) { const i = bs.indexOf(q0); kb.dd = Math.max(-i, Math.min(bs.length - 1 - i, kb.dd + dD)); }
  // shown at once by moving the block; written once the keys rest
  const qt = (q0 && bs[bs.indexOf(q0) + kb.dd]) || q0, px = kb.dt / (3600e3 / o.scale), ox = qt && q0 ? (o.along === 'y' ? qt.r.left - q0.r.left : 0) : 0, oy = qt && q0 ? (o.along === 'x' ? qt.r.top - q0.r.top : 0) : 0;
  node.style.transform = o.along === 'x' ? `translate(${px}px, ${oy}px)` : `translate(${ox}px, ${px}px)`; node.classList.add('dragging');
  const s = new Date(+shiftDays(it.start, kb.dd) + kb.dt), en = new Date(+shiftDays(it.end, kb.dd) + kb.dt), m = node.querySelector('.m'); if (m) m.textContent = (kb.dd ? dayShort(s) + ', ' : '') + hm(s) + ' to ' + hm(en);
  window.clearTimeout(kb.timer); kb.timer = window.setTimeout(() => commitKeys(C), 700);
  return true;
}

// ---------- the editor: click a Google event of yours, or make a new one ----------
/** URLs in a text become links that open (built as text and links, never as HTML). */
export function linked(text: string, cls: string): HTMLElement {
  const p = el('p', cls), re = /https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?]/g; let i = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) { p.append(text.slice(i, m.index)); const a = el('a', null, m[0]); a.href = m[0]; a.target = '_blank'; a.rel = 'noopener'; p.append(a); i = m.index + m[0].length; }
  p.append(text.slice(i)); return p;
}
const input = (type: string, value: string, aria: string) => { const i = el('input', 'pop-f'); i.type = type; i.value = value; i.setAttribute('aria-label', aria); return i; };

/** The editor for a new event (it: null, with nw) or one of yours. Changes are saved when it closes (Save, Enter, Esc, a
 *  click outside): one write, one Undo. A new one is made only with Add. */
export function editor(C: V, it: Item | null, at: any, nw?: { a: Date; b: Date; allDay: boolean; done: () => void }): void {
  const isNew = !it, p = C.popAt(at, isNew ? 'New event' : it!.title); p.classList.add('ed');
  const name = el('input', 'pop-in'); name.value = isNew ? '' : it!.title; name.placeholder = isNew ? 'What is it?' : 'Name'; name.setAttribute('aria-label', 'Event name');
  p.append(name);
  const s0 = isNew ? nw!.a : it!.start, e0 = isNew ? nw!.b : it!.end, ad0 = isNew ? !!nw!.allDay : it!.allDay;
  const lastDay = ad0 ? shiftDays(e0, -1) : e0;
  const sd = input('date', iso(s0), 'Starts on'), st = input('time', hm(s0), 'Starts at'), ed = input('date', iso(lastDay), 'Ends on'), et = input('time', hm(e0), 'Ends at');
  const all = el('input', 'pop-check'); all.type = 'checkbox'; all.checked = ad0;
  const allL = el('label', 'pop-allday'); allL.append(all, 'All day');
  const when = el('div', 'pop-when'), r1 = el('div', 'pop-line'), r2 = el('div', 'pop-line');
  r1.append(el('span', 'pop-lab', 'From'), sd, st); r2.append(el('span', 'pop-lab', 'To'), ed, et); when.append(r1, r2, allL); p.append(when);
  const showTimes = () => { st.hidden = et.hidden = all.checked; }; showTimes();
  all.onchange = () => { if (!all.checked && ad0) { st.value = '09:00'; et.value = '10:00'; ed.value = sd.value; } showTimes(); };
  // the calendar list comes first: the colour swatches read it (a new event's 'calendar colour')
  let cals: GCal[] = [];
  const sel = el('select', 'pop-f'); sel.setAttribute('aria-label', 'Calendar');
  // colour: the calendar's, or one of Google's eleven
  let color = isNew ? '' : it!.g?.colorId || '';
  const sws = el('div', 'swatches'); sws.setAttribute('role', 'radiogroup'); sws.setAttribute('aria-label', 'Colour');
  const swb: HTMLButtonElement[] = [];
  const paint = () => swb.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.c === color)));
  const calColor = () => (isNew ? cals.find((c) => c.id === sel.value)?.color : it!.g?.calColor) || '#8A93A6';
  ([['', "Calendar's colour"], ...Object.entries(COLORS).map(([k, v]) => [k, v[0]])] as [string, string][]).forEach(([k, nm]) => {
    const b = el('button', 'sw'); b.type = 'button'; b.dataset.c = k; b.title = nm; b.setAttribute('role', 'radio'); b.setAttribute('aria-label', nm);
    b.style.setProperty('--c', k ? COLORS[k][1] : calColor()); if (!k) b.classList.add('cal');
    b.onclick = () => { color = k; paint(); };
    swb.push(b); sws.append(b);
  });
  paint(); p.append(sws);
  const loc = input('text', isNew ? '' : it!.location || '', 'Place'); loc.placeholder = 'Add a place';
  const locRow = el('div', 'pop-line'); locRow.append(loc); p.append(locRow);
  const desc0 = isNew ? '' : it!.desc || '';
  let notes: HTMLTextAreaElement | null = null;
  const nbox = el('div', 'pop-notesbox');
  const openNotes = () => { if (notes) return; notes = el('textarea', 'pop-f notes'); notes.value = desc0; notes.rows = 4; notes.placeholder = 'Description'; notes.setAttribute('aria-label', 'Description'); nbox.textContent = ''; nbox.append(notes); notes.focus(); };
  if (desc0) nbox.append(linked(desc0, 'pop-desc'));
  { const eb = el('button', 'pop-link', desc0 ? 'Edit description' : 'Add description'); eb.type = 'button'; eb.onclick = openNotes; nbox.append(eb); }
  p.append(nbox);
  // calendar: a new one goes into any of yours
  const calRow = el('div', 'pop-line'); calRow.hidden = true; calRow.append(el('span', 'pop-lab', 'Calendar'), sel); if (isNew) p.append(calRow);
  let loaded = !isNew;
  const calsP = isNew ? C.plugin.google.writable().catch(() => []).then((list) => {
    loaded = true; cals = list;
    cals.forEach((c) => { const op = el('option', null, c.name); op.value = c.id; sel.append(op); });
    const d = C.plugin.google.defaultCal(cals); if (d) sel.value = d.id;
    calRow.hidden = cals.length < 2;
    swb[0]?.style.setProperty('--c', calColor());
  }) : Promise.resolve();
  sel.onchange = () => swb[0]?.style.setProperty('--c', calColor());
  const acts = el('div', 'acts'); p.append(acts);

  const read = (): GFields | null => {
    const f: GFields = {}, t = name.value.trim(), A = all.checked;
    let s = new Date(sd.value + 'T' + (A ? '00:00' : st.value || '00:00')), en = new Date(ed.value + 'T' + (A ? '00:00' : et.value || '00:00'));
    if (isNaN(+s) || isNaN(+en)) return null;
    if (A) en = shiftDays(en, 1); // the last day, shown; Google wants the day after
    if (+en <= +s) en = A ? shiftDays(s, 1) : new Date(+s + Math.max(SNAP, +e0 - +s0));
    if (isNew) return { title: t, start: s, end: en, allDay: A, colorId: color, desc: notes ? notes.value : '', location: loc.value.trim() };
    if (t && t !== it!.title) f.title = t;
    if (+s !== +it!.start || +en !== +it!.end || A !== it!.allDay) { f.start = s; f.end = en; f.allDay = A; }
    if (color !== (it!.g?.colorId || '')) f.colorId = color;
    if (notes && notes.value !== desc0) f.desc = notes.value;
    if (loc.value.trim() !== (it!.location || '')) f.location = loc.value.trim();
    return f;
  };
  let gone = false;
  if (isNew) {
    const add = el('button', 'primary', 'Add to Google Calendar'), no = el('button', null, 'Cancel'); acts.append(add, no);
    const close = () => { C.closePop(); nw!.done(); }; no.onclick = close; C.onPopClose(nw!.done);
    const go = () => {
      if (!loaded) { void calsP.then(go); return; }
      const f = read(); if (!f) return; if (!f.title || !sel.value) { name.focus(); return; }
      C.plugin.local.set('google-default-cal', sel.value);
      gone = true; close(); void create(C, sel.value, f);
    };
    add.onclick = go; name.onkeydown = (k) => { if (k.key === 'Enter') go(); if (k.key === 'Escape') close(); };
  } else {
    const save = () => { if (gone) return; gone = true; const f = read(); if (!f || !Object.keys(f).length) { C.draw(); return; } void change(C, it!, f); };
    const ok = el('button', 'primary', 'Save'), del = el('button', 'danger', 'Delete'); let armedDel = false;
    ok.onclick = () => C.closePop();
    del.onclick = () => { if (!armedDel) { armedDel = true; del.textContent = 'Sure? Delete it'; return; } gone = true; C.closePop(); void remove(C, it!); };
    acts.append(ok, del);
    if (it!.meet) { const m = el('a', null, 'Join the video call'); m.href = it!.meet; m.target = '_blank'; m.rel = 'noopener'; acts.append(m); }
    if (it!.link) { const a = el('a', null, 'Open in Google'); a.href = it!.link; a.target = '_blank'; a.rel = 'noopener'; acts.append(a); }
    if (it!.g?.rec) p.insertBefore(el('p', 'pop-hint', 'A repeating event: changes here are for this day only.'), acts);
    C.onPopClose(() => { C.refocus = true; save(); });
    p.addEventListener('keydown', (k) => { if (k.key === 'Enter' && !(k.target instanceof HTMLTextAreaElement && !k.metaKey && !k.ctrlKey)) { k.preventDefault(); C.closePop(); } });
  }
  name.focus(); if (!isNew) name.select();
}
