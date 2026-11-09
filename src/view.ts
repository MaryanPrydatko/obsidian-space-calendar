// The calendar view: Space's calendar (calendar.js) in an Obsidian pane.
// Views: Now (what is on, then what comes), Day and Week (time Across or Down, see time.ts), Month.
// Items: Kanban cards with a date ("My plan"), ICS feeds and Google Calendar events; daily notes as markers on their day.
// Everything is scoped to this pane: its own keys, popovers and toast, sized from the pane, not the window.
import { ItemView, TFile, type WorkspaceLeaf } from 'obsidian';
import type SpaceCalendarPlugin from './main';
import type { Item } from './types';
import { addDays, colorFor, day0, dayName, el, fromIso, hm, inMin, iso, sameDay, weekStart } from './util';
import * as T from './time';
import * as E from './edit';

export const VIEW_TYPE = 'space-calendar';
export type ViewName = 'now' | 'day' | 'week' | 'month';

export class SpaceCalendarView extends ItemView {
  plugin: SpaceCalendarPlugin;
  root!: HTMLElement;
  main!: HTMLElement;
  items: Item[] = [];
  focus: Date = day0(new Date());
  view: ViewName = 'week';
  orient: 'x' | 'y' = 'x';
  hz = 1;
  picked = '';
  refocus = false;
  goNow = false;
  pop: HTMLElement | null = null;
  private popDone: (() => void) | null = null;
  private noClick = 0;
  private lastKey = '';
  private bar: Record<string, HTMLElement> = {};
  undos: { label: string; run: () => void }[] = [];
  private toastT = 0;
  private unsub: (() => void) | null = null;
  private drawT = 0;

  constructor(leaf: WorkspaceLeaf, plugin: SpaceCalendarPlugin) { super(leaf); this.plugin = plugin; }
  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return 'Calendar'; }
  getIcon(): string { return 'calendar-days'; }

  // ---------- helpers the views and the editing share ----------
  ws(): number { return this.plugin.settings.weekStart; }
  wkStart(d: Date): Date { return weekStart(d, this.ws()); }
  byId(id: string): Item | undefined { return this.items.find((x) => x.id === id); }
  suppressClick(): void { this.noClick = Date.now(); }
  clickOk(): boolean { return Date.now() - this.noClick >= 300; }
  /** Width and height of the pane, standing in for Space's window. */
  get W(): number { return this.root.clientWidth || 900; }
  get H(): number { return this.root.clientHeight || 700; }

  async onOpen(): Promise<void> {
    const L = this.plugin.local;
    const v = L.get<string>('view', this.plugin.settings.defaultView);
    this.view = /^(now|day|week|month)$/.test(v) ? (v as ViewName) : 'week';
    this.orient = L.get<string>('orient', 'x') === 'y' ? 'y' : 'x';
    this.hz = Math.max(0.55, Math.min(2.4, +L.get<number>('hz', 1) || 1));
    this.root = this.contentEl; this.root.empty(); this.root.addClass('space-cal');
    this.root.tabIndex = -1;
    this.buildBar();
    this.main = this.root.createDiv({ cls: 'sc-main' });
    this.registerDomEvent(this.root, 'keydown', (e) => this.onKey(e));
    this.registerDomEvent(this.root, 'pointerdown', (e) => {
      const t = e.target as HTMLElement;
      if (this.pop && !this.pop.contains(t) && !t.closest('.ev, .card, .chip, .wbar, .it')) {
        if (e.pointerType !== 'touch' && t.classList.contains('tbox')) E.noteClick(e);
        this.closePop();
      }
    });
    this.unsub = this.plugin.onChange(() => this.soon());
    this.registerInterval(window.setInterval(() => { if (!this.pop && this.view !== 'month') this.draw(); }, 60e3)); // the now line and "in 25 min" move on
    this.reload();
  }
  async onClose(): Promise<void> { this.unsub?.(); this.closePop(); window.clearTimeout(this.toastT); }
  onResize(): void { this.soon(); }
  /** A redraw soon (sources change in bursts), never while a form is open. */
  soon(): void { window.clearTimeout(this.drawT); this.drawT = window.setTimeout(() => { if (!this.pop) this.reload(); }, 120); }

  // ---------- data ----------
  range(): [Date, Date] {
    if (this.view === 'day') return [this.focus, this.focus];
    if (this.view === 'week') { const m = this.wkStart(this.focus); return [m, addDays(m, 6)]; }
    if (this.view === 'month') { const m = this.wkStart(new Date(this.focus.getFullYear(), this.focus.getMonth(), 1)); return [m, addDays(m, 41)]; }
    const t = day0(new Date()); return [t, addDays(t, 6)];
  }
  /** What is known now, drawn at once; Google is asked behind when its copy does not cover the range. */
  reload(): void {
    const [a, b] = this.range(), end = addDays(b, 1);
    this.items = this.collect(a, end);
    this.draw();
    this.plugin.google.ensure(a, end);
  }
  private collect(a: Date, end: Date): Item[] {
    const P = this.plugin, out: Item[] = [];
    const lo = iso(a), hi = iso(end), showDone = P.settings.showDone;
    for (const c of P.kanban.cards()) {
      if (c.date < lo || c.date >= hi || (c.done && !showDone)) continue;
      const board = c.path.replace(/^.*\//, '').replace(/\.md$/, '');
      const start = fromIso(c.date);
      let s = start, e = addDays(start, 1), allDay = true, openEnd = false;
      if (c.time) { const [h, m] = c.time.split(':').map(Number); s = new Date(start.getFullYear(), start.getMonth(), start.getDate(), h, m); e = new Date(+s + (c.mins || 45) * 60e3); allDay = false; openEnd = !c.mins; }
      out.push({ id: 'k:' + c.path + ':' + c.line, title: c.title, start: s, end: e, allDay, openEnd, color: colorFor(c.path), kind: 'card', src: 'kanban', done: c.done, calName: board, card: c });
    }
    out.push(...P.ics.items(a, end));
    out.push(...P.google.items(a, end));
    return out.filter((it) => it.end > a && it.start < end);
  }
  dailyFor(d: Date): TFile | undefined { return this.plugin.daily.dates().get(iso(d)); }
  dailyMark(d: Date): HTMLElement | null {
    const f = this.dailyFor(d); if (!f) return null;
    const b = el('button', 'daily-mark'); b.type = 'button'; b.title = 'Daily note, ' + dayName(d, 'long'); b.setAttribute('aria-label', b.title);
    b.onclick = (e) => { e.stopPropagation(); this.openFile(f); };
    return b;
  }
  openFile(f: TFile): void {
    const open = this.app.workspace.getLeavesOfType('kanban').concat(this.app.workspace.getLeavesOfType('markdown')).find((l) => (l.view as any)?.file?.path === f.path);
    if (open) { this.app.workspace.setActiveLeaf(open, { focus: true }); return; }
    void this.app.workspace.getLeaf('tab').openFile(f);
  }
  openCard(it: Item): void {
    const f = it.card && this.app.vault.getAbstractFileByPath(it.card.path);
    if (f instanceof TFile) this.openFile(f);
  }

  // ---------- shared pieces ----------
  /** Packs overlapping things into lanes; a short one counts as at least minMs long so its card stays readable. */
  pack(list: Item[], minMs = 0): number {
    const ends: number[] = [];
    list.sort((p, q) => +p.start - +q.start || +q.end - +p.end).forEach((it) => {
      let l = ends.findIndex((e) => e <= +it.start); if (l < 0) { l = ends.length; ends.push(0); }
      ends[l] = Math.max(+it.end, +it.start + minMs); it.lane = l;
    });
    return Math.max(1, ends.length);
  }
  /** Lanes for time running down: things that overlap share a group, each group splits the width by its own lanes, and a
   *  thing takes as many free lanes to its right as it can, so one alone at its time is full width. */
  layout(list: Item[], minMs = 0): number {
    const eff = (it: Item) => Math.max(+it.end, +it.start + minMs);
    const sorted = list.sort((p, q) => +p.start - +q.start || +q.end - +p.end); let most = 1;
    for (let i = 0; i < sorted.length;) {
      let j = i, until = eff(sorted[i]); while (j + 1 < sorted.length && +sorted[j + 1].start < until) { j++; until = Math.max(until, eff(sorted[j])); }
      const grp = sorted.slice(i, j + 1), n = this.pack(grp, minMs); most = Math.max(most, n);
      grp.forEach((it) => { let sp = 1; const a = +it.start, b = eff(it); while ((it.lane || 0) + sp < n && !grp.some((o) => o.lane === (it.lane || 0) + sp && +o.start < b && eff(o) > a)) sp++; it.lanes = n; it.span = sp; });
      i = j + 1;
    }
    return most;
  }
  timeLine(it: Item): string { return hm(it.start) + (it.openEnd ? '' : ' to ' + hm(it.end)); }
  block(it: Item, when?: string | false): HTMLElement {
    const b = el('div', 'ev' + (it.kind === 'card' ? ' note' : '') + (it.done ? ' done' : '') + (it.end < new Date() ? ' past' : '') + (it.editable ? ' can-edit' : '') + (it.kind === 'card' ? ' can-move' : ''));
    b.dataset.id = it.id; b.style.setProperty('--c', it.color);
    b.append(el('div', 't', it.title));
    if (when !== false) b.append(el('div', 'm', when || this.timeLine(it) + (it.calName ? ' · ' + it.calName : '')));
    b.title = it.title + ', ' + this.timeLine(it) + (it.calName ? ' (' + it.calName + ')' : ''); b.tabIndex = 0; b.setAttribute('role', 'button');
    b.onclick = (e) => { if (!this.clickOk()) return; this.detail(it, e); };
    b.onkeydown = (e) => { if (e.key === 'Enter') this.detail(it, b.getBoundingClientRect()); };
    b.onfocus = () => { this.picked = it.id; };
    return b;
  }
  chip(it: Item): HTMLElement {
    const c = el('button', 'chip' + (it.kind === 'card' ? ' note' : '') + (it.done ? ' done' : ''), it.title); c.type = 'button'; c.dataset.id = it.id; c.style.setProperty('--c', it.color);
    c.title = it.title + (it.calName ? ' (' + it.calName + ')' : '');
    c.onclick = (e) => { if (this.clickOk()) this.detail(it, e); };
    if (it.kind === 'card') E.cardDrag(this, c, it);
    return c;
  }
  openDay(d: Date): void { this.focus = d; this.setView('day'); }

  // ---------- where we are now (top of Day and Week, today) ----------
  private nowStrip(): HTMLElement {
    const now = new Date(), timed = this.items.filter((it) => !it.allDay && !it.done).sort((a, b) => +a.start - +b.start);
    const on = timed.filter((it) => it.start <= now && it.end > now)[0], next = timed.filter((it) => it.start > now)[0];
    const s = el('div', 'nowstrip' + (on ? '' : ' free')); s.append(el('b', null, 'Now ' + hm(now)));
    if (on) s.append(el('span', null, on.title + (on.openEnd ? ', since ' + hm(on.start) : ', ' + inMin((+on.end - +now) / 60e3) + ' left')));
    else s.append(el('span', null, next && sameDay(next.start, now) ? 'Free for ' + inMin((+next.start - +now) / 60e3) : 'Free for the rest of today'));
    if (next) s.append(el('span', 'faint', 'Next: ' + next.title + (sameDay(next.start, now) ? ' at ' + hm(next.start) : ', ' + dayName(next.start, 'short'))));
    const open = this.items.filter((it) => it.kind === 'card' && !it.done && sameDay(it.start, now)).length;
    if (open) s.append(el('span', 'faint', open + (open === 1 ? ' open card today' : ' open cards today')));
    return s;
  }

  // ---------- Now: what is on, then what comes, smaller the further away ----------
  private drawNow(main: HTMLElement): void {
    const flow = el('div', 'flow'); main.append(flow);
    const now = new Date(), t0 = day0(now), timed = this.items.filter((it) => !it.allDay && !it.done).sort((a, b) => +a.start - +b.start);
    const on = timed.filter((it) => it.start <= now && it.end > now), coming = timed.filter((it) => it.start > now);
    const col = (cls: string, title: string) => { const c = el('section', 'col ' + cls), l = el('div', 'list'); c.append(el('h3', null, title), l); flow.append(c); return l; };
    const card = (it: Item, big?: boolean) => {
      const c = el('div', 'card' + (it.kind === 'card' ? ' note' : '')); c.style.setProperty('--c', it.color); c.tabIndex = 0; c.setAttribute('role', 'button');
      const mins = (+it.start - +now) / 60e3, when = it.start <= now ? (it.openEnd ? 'since ' + hm(it.start) : 'until ' + hm(it.end) + ', ' + inMin((+it.end - +now) / 60e3) + ' left') : sameDay(it.start, now) ? hm(it.start) + (mins < 180 ? ', in ' + inMin(mins) : '') : dayName(it.start, 'short') + ', ' + hm(it.start);
      c.append(el('div', 'tm', when), el('div', 'ti', it.title));
      if (it.calName) c.append(el('div', 'cn', it.calName));
      if (big && it.start <= now && !it.openEnd) { const b = el('div', 'bar-left'), i = el('i'); i.style.width = Math.round(100 * (+now - +it.start) / (+it.end - +it.start)) + '%'; b.append(i); c.append(b); }
      c.onclick = (e) => this.detail(it, e); c.onkeydown = (e) => { if (e.key === 'Enter') this.detail(it, c.getBoundingClientRect()); };
      return c;
    };
    const nowL = col('now', 'Now');
    if (on.length) on.forEach((it, i) => nowL.append(card(it, i === 0)));
    else { const f = el('div', 'free'), nx = coming[0]; f.append(el('div', 'ti', 'Free'), el('div', 'tm', nx ? (sameDay(nx.start, now) ? 'until ' + hm(nx.start) + ', ' + inMin((+nx.start - +now) / 60e3) : 'for the rest of today') : 'nothing planned ahead')); nowL.append(f); }
    const allToday = this.items.filter((it) => it.allDay && sameDay(it.start, now) && !it.done);
    const dm = this.dailyFor(now);
    if (allToday.length || dm) {
      const r = el('div', 'allday'); allToday.forEach((it) => r.append(this.chip(it)));
      if (dm) { const c = el('button', 'chip daily', 'Daily note'); c.type = 'button'; c.onclick = () => this.openFile(dm); r.prepend(c); }
      nowL.append(el('h3', null, 'Today, any time'), r);
    }
    const todayRest = coming.filter((it) => sameDay(it.start, now));
    if (todayRest.length) col('next', 'Next').append(card(todayRest[0], true));
    if (todayRest.length > 1) { const ll = col('later', 'Later today'); todayRest.slice(1).forEach((it) => ll.append(card(it))); }
    const tm = coming.filter((it) => sameDay(it.start, addDays(t0, 1)));
    const tl = col('tomorrow', 'Tomorrow, ' + dayName(addDays(t0, 1), 'short')); if (tm.length) tm.forEach((it) => tl.append(card(it))); else tl.append(el('p', 'tm', 'Nothing at a set time.'));
    for (let i = 2; i < 7; i++) { const d = addDays(t0, i), its = coming.filter((it) => sameDay(it.start, d)); if (!its.length) continue; const l = col('week-c', dayName(d, 'long').split(' ')[0] + ' ' + d.getDate()); its.forEach((it) => l.append(card(it))); }
  }

  // ---------- Month ----------
  private drawMonth(main: HTMLElement): void {
    const sc = el('div', 'scroll'), g = el('div', 'month'); sc.append(g); main.append(sc);
    const s = this.wkStart(new Date(this.focus.getFullYear(), this.focus.getMonth(), 1)), today = iso(new Date());
    for (let i = 0; i < 7; i++) g.append(el('div', 'dow', addDays(s, i).toLocaleDateString('en-GB', { weekday: 'short' })));
    for (let i = 0; i < 42; i++) {
      const d = addDays(s, i), its = this.items.filter((it) => it.start < addDays(d, 1) && it.end > d).sort((a, b) => (+b.allDay - +a.allDay) || +a.start - +b.start);
      const c = el('div', 'mcell' + (d.getMonth() !== this.focus.getMonth() ? ' other' : '') + (iso(d) === today ? ' today' : '')); c.dataset.day = iso(d);
      const n = el('div', 'n'); n.append(el('span', null, String(d.getDate()))); const dm = this.dailyMark(d); if (dm) n.append(dm); c.append(n);
      its.slice(0, 4).forEach((it) => {
        const x = el('div', 'it' + (it.kind === 'card' ? ' note' : '') + (it.done ? ' done' : ''), (it.allDay ? '' : hm(it.start) + ' ') + it.title); x.style.setProperty('--c', it.color); x.dataset.id = it.id; x.title = it.title + (it.calName ? ' (' + it.calName + ')' : '');
        x.onclick = (e) => { e.stopPropagation(); if (this.clickOk()) this.detail(it, e); };
        if (it.kind === 'card') E.cardDrag(this, x, it);
        c.append(x);
      });
      if (its.length > 4) c.append(el('div', 'more', '+' + (its.length - 4) + ' more'));
      c.onclick = () => { if (this.clickOk()) this.openDay(d); }; g.append(c);
    }
  }

  // ---------- the detail that opens on a click ----------
  closePop(): void { if (this.pop) this.pop.remove(); this.pop = null; const f = this.popDone; this.popDone = null; if (f) f(); }
  onPopClose(f: () => void): void { this.popDone = f; }
  /** A popover inside the pane, near the click (or a rectangle), kept inside the pane. */
  popAt(at: any, label: string): HTMLElement {
    this.closePop(); const p = el('div', 'pop'); p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', label); this.root.append(p); this.pop = p;
    const place = () => {
      const R = this.root.getBoundingClientRect(), pr = p.getBoundingClientRect();
      const r = at && at.clientX != null ? { left: at.clientX, bottom: at.clientY } : at || { left: R.left + R.width / 2, bottom: R.top + R.height / 3 };
      p.style.left = Math.max(12, Math.min(R.width - pr.width - 12, r.left - R.left - 20)) + 'px';
      p.style.top = Math.max(12, Math.min(R.height - pr.height - 12, r.bottom - R.top + 8)) + 'px';
    };
    place(); requestAnimationFrame(place);
    return p;
  }
  detail(it: Item, at: any): void {
    this.picked = it.id;
    if (it.kind === 'card') { this.openCard(it); return; } // a card: its board opens
    if (it.kind === 'event' && it.editable) { E.editor(this, it, at); return; } // yours: change it right here
    const p = this.popAt(at, it.title);
    p.append(el('h4', null, it.title), el('p', null, it.allDay ? dayName(it.start, 'long') + ', all day' + (+it.end - +it.start > 864e5 ? ' to ' + dayName(addDays(it.end, -1), 'long') : '') : dayName(it.start, 'long') + ', ' + hm(it.start) + ' to ' + hm(it.end)));
    if (it.calName) p.append(el('p', null, it.calName + (it.src === 'ics' ? ' (feed, read only)' : ' (read only)')));
    if (it.location) { const a = el('a', 'pop-loc', it.location); a.href = 'https://maps.google.com/?q=' + encodeURIComponent(it.location); a.target = '_blank'; a.rel = 'noopener'; p.append(a); }
    if (it.desc) p.append(E.linked(it.desc, 'pop-desc'));
    const acts = el('div', 'acts');
    if (it.meet) { const m = el('a', 'primary', 'Join the video call'); m.href = it.meet; m.target = '_blank'; m.rel = 'noopener'; acts.append(m); }
    if (it.link && /^https?:/.test(it.link)) { const a = el('a', null, it.src === 'google' ? 'Open in Google' : 'Open link'); a.href = it.link; a.target = '_blank'; a.rel = 'noopener'; acts.append(a); }
    const x = el('button', null, 'Close'); x.onclick = () => this.closePop(); acts.append(x); p.append(acts);
    x.focus();
  }

  // ---------- a message at the foot of the pane, with Undo (also Cmd+Z) ----------
  toast(msg: string, undo?: () => void): void {
    let t = this.root.querySelector<HTMLElement>('.sc-toast'); if (!t) { t = el('div', 'sc-toast'); t.setAttribute('role', 'status'); this.root.append(t); }
    t.textContent = ''; t.append(msg);
    if (undo) {
      const entry = { label: msg, run: undo }; this.undos.push(entry); if (this.undos.length > 50) this.undos.shift();
      const b = el('button', null, 'Undo'); b.type = 'button'; b.onclick = () => { this.hideToast(); const i = this.undos.indexOf(entry); if (i >= 0) this.undos.splice(i, 1); undo(); }; t.append(b);
    }
    t.classList.add('on'); window.clearTimeout(this.toastT); this.toastT = window.setTimeout(() => this.hideToast(), undo ? 9000 : 3500);
  }
  hideToast(): void { this.root.querySelector('.sc-toast')?.classList.remove('on'); }
  undo(): void { const e = this.undos.pop(); if (!e) { this.toast('Nothing to undo here.'); return; } this.hideToast(); e.run(); }

  // ---------- keys (only while the calendar has the focus) ----------
  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && this.pop) { e.preventDefault(); e.stopPropagation(); this.closePop(); return; }
    const t = e.target as HTMLElement;
    if (e.key === 'Escape' && t.closest('.ev')) { t.blur(); this.root.focus(); return; }
    if (t.closest('input, textarea, select')) return;
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); this.undo(); return; }
    const evEl = t.closest<HTMLElement>('.ev');
    if (evEl && !this.pop && E.key(this, evEl, e)) { e.preventDefault(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const v = ({ 1: 'now', 2: 'day', 3: 'week', 4: 'month' } as Record<string, ViewName>)[e.key]; if (v) { this.setView(v); return; }
    if (e.key === 'ArrowLeft') this.step(-1); if (e.key === 'ArrowRight') this.step(1);
    if (e.key === 't' || e.key === 'T') { this.goNow = true; this.focus = day0(new Date()); this.reload(); }
  }

  // ---------- the bar ----------
  step(n: number): void {
    if (this.view === 'now') return;
    this.focus = this.view === 'day' ? addDays(this.focus, n) : this.view === 'week' ? addDays(this.focus, 7 * n) : new Date(this.focus.getFullYear(), this.focus.getMonth() + n, 1);
    this.reload();
  }
  setView(v: ViewName): void { this.view = v; this.plugin.local.set('view', v); this.reload(); }
  setHz(f: number): void { this.hz = Math.max(0.55, Math.min(2.4, Math.round(this.hz * f * 100) / 100)); this.plugin.local.set('hz', this.hz); this.draw(); }
  private buildBar(): void {
    const bar = this.root.createDiv({ cls: 'bar' }), B = this.bar;
    const seg = (cls: string, label: string) => { const s = bar.createDiv({ cls: 'seg ' + cls }); s.setAttribute('role', 'group'); s.setAttribute('aria-label', label); return s; };
    const btn = (host: HTMLElement, text: string, fn: () => void, title?: string) => { const b = host.createEl('button', { text }); b.type = 'button'; if (title) { b.title = title; b.setAttribute('aria-label', title); } b.onclick = fn; return b; };
    const views = seg('views', 'View');
    (['now', 'day', 'week', 'month'] as ViewName[]).forEach((v) => { const b = btn(views, v[0].toUpperCase() + v.slice(1), () => this.setView(v)); b.dataset.v = v; });
    B.orient = seg('orient', 'Which way time runs');
    btn(B.orient, 'Across', () => { this.orient = 'x'; this.plugin.local.set('orient', 'x'); this.draw(); }, 'Time runs left to right').dataset.o = 'x';
    btn(B.orient, 'Down', () => { this.orient = 'y'; this.plugin.local.set('orient', 'y'); this.draw(); }, 'Time runs top to bottom').dataset.o = 'y';
    B.hsize = seg('size', 'Hour size');
    B.hzm = btn(B.hsize, '−', () => this.setHz(0.8), 'Smaller hours'); B.hzp = btn(B.hsize, '+', () => this.setHz(1.25), 'Bigger hours');
    B.when = bar.createSpan({ cls: 'when' });
    B.off = bar.createSpan({ cls: 'note-off' });
    const step = bar.createSpan({ cls: 'step' });
    B.prev = btn(step, '‹', () => this.step(-1), 'Back');
    btn(step, 'Today', () => { this.goNow = true; this.focus = day0(new Date()); this.reload(); });
    B.next = btn(step, '›', () => this.step(1), 'Forward');
  }

  draw(): void {
    if (!this.main) return;
    // a redraw (an edit, the minute tick, a board changing) keeps where you scrolled; only a new view, date or Today goes to now
    const main = this.main, key = this.view + '|' + this.orient + '|' + iso(this.focus) + '|' + this.hz, old = main.querySelector<HTMLElement>('.scroll');
    const keep = old && key === this.lastKey && !this.goNow ? { t: old.scrollTop, l: old.scrollLeft } : null; this.lastKey = key; this.goNow = false;
    const had = document.activeElement?.closest?.('.ev') as HTMLElement | null, focusId = had && this.root.contains(had) ? had.dataset.id : this.refocus ? this.picked : '';
    const typing = !!(this.pop && this.pop.contains(document.activeElement));
    main.textContent = ''; if (this.pop && !typing) this.closePop();
    const B = this.bar, v = this.view;
    this.root.querySelectorAll<HTMLElement>('.seg.views button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
    this.root.querySelectorAll<HTMLElement>('.seg.orient button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.o === this.orient)));
    B.orient.hidden = B.hsize.hidden = !(v === 'day' || v === 'week');
    (B.hzm as HTMLButtonElement).disabled = this.hz <= 0.55; (B.hzp as HTMLButtonElement).disabled = this.hz >= 2.4;
    const m = this.wkStart(this.focus);
    B.when.textContent = v === 'now' ? new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : v === 'day' ? dayName(this.focus, 'long') : v === 'week' ? 'Week of ' + m.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) : this.focus.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    B.prev.hidden = B.next.hidden = v === 'now';
    const gs = this.plugin.google.state();
    B.off.textContent = gs === 'expired' ? 'Google sign-in ended. Connect again in settings.' : gs === 'error' ? 'Google did not answer. Showing what was known.' : '';
    B.off.hidden = !B.off.textContent;
    const showsToday = (v === 'day' && sameDay(this.focus, new Date())) || (v === 'week' && sameDay(m, this.wkStart(new Date())));
    if (showsToday) main.append(this.nowStrip());
    if (v === 'now') this.drawNow(main); else if (v === 'month') this.drawMonth(main); else if (v === 'day') T.day(this, main); else T.week(this, main);
    if (keep) { const sc = main.querySelector<HTMLElement>('.scroll'); if (sc) { sc.scrollTop = keep.t; sc.scrollLeft = keep.l; requestAnimationFrame(() => { sc.scrollTop = keep.t; sc.scrollLeft = keep.l; }); } }
    this.refocus = false;
    if (focusId && !typing) { const b = main.querySelector<HTMLElement>('.ev[data-id="' + CSS.escape(focusId) + '"]'); if (b) b.focus({ preventScroll: true }); }
  }
}
