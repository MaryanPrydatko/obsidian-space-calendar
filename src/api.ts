// The agent API: what an agent (Claude Code, Codex) uses through the Obsidian CLI, for example
//   obsidian eval code="return await app.plugins.plugins['space-calendar'].api.events('2026-11-16', '2026-11-22')"
// Plain JSON in and out. Times are local: 'YYYY-MM-DDTHH:mm', days 'YYYY-MM-DD'. An all-day event's end is its last day
// (inclusive). Nothing here returns tokens, client secrets or feed addresses.
import type SpaceCalendarPlugin from './main';
import type { Card } from './sources/kanban-parse';
import type { GCal } from './sources/google';
import type { GFields, Item } from './types';
import { addDays, hm, iso } from './util';

export interface ApiEvent { id: string; title: string; start: string; end: string; allDay: boolean; calendar: string; calendarId: string; editable: boolean; recurring: boolean; location: string; desc: string }
export interface ApiCard { board: string; line: number; date: string; time: string; done: boolean; title: string; column: string; text: string }
export interface ApiCalendar { id: string; name: string; account: string; access: string; primary: boolean; isDefault: boolean }
/** start/end: 'YYYY-MM-DDTHH:mm', or 'YYYY-MM-DD' with allDay. calendar: a calendar's id or name; default: the calendar
 *  new events go to in the calendar view. */
export interface EventInput { title?: string; start?: string; end?: string; allDay?: boolean; desc?: string; location?: string; colorId?: string; calendar?: string }

const local = (d: Date, allDay: boolean): string => (allDay ? iso(d) : iso(d) + 'T' + hm(d));
function when(s: string, what: string): Date {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : new Date(s);
  if (typeof s !== 'string' || isNaN(+d)) throw new Error(what + ' is not a date or time: ' + s);
  return d;
}

export class SpaceCalendarApi {
  readonly version = 1;
  private seen = new Map<string, Item>(); // events handed out, so update and remove can find them by id
  constructor(private p: SpaceCalendarPlugin) {}

  status(): { google: string; accounts: string[]; boards: number } {
    return { google: this.p.google.state(), accounts: this.p.google.emails(), boards: this.p.kanban.boards().length };
  }

  async calendars(): Promise<ApiCalendar[]> {
    const g = this.p.google, all = await g.calendars(), def = g.defaultCal(await g.writable());
    return all.map((c) => ({ id: c.id, name: c.name, account: c.acct, access: c.access, primary: c.primary, isDefault: !!def && c.id === def.id }));
  }

  /** Every Google event from the first day to the last (both included), read fresh from Google, sorted by start. */
  async events(from: string, to: string): Promise<ApiEvent[]> {
    const a = when(from, 'from'), b = /^\d{4}-\d{2}-\d{2}$/.test(to) ? addDays(when(to, 'to'), 1) : when(to, 'to');
    await this.p.google.load(a, b);
    const items = this.p.google.items(a, b).sort((x, y) => +x.start - +y.start);
    items.forEach((it) => this.seen.set(it.id, it));
    return items.map((it) => this.event(it));
  }

  /** Dated cards on every board, from the first day to the last (both included; both optional), by date and time. */
  cards(from?: string, to?: string): ApiCard[] {
    return this.p.kanban.cards()
      .filter((c) => (!from || c.date >= from) && (!to || c.date <= to))
      .sort((x, y) => x.date.localeCompare(y.date) || (x.time || '99').localeCompare(y.time || '99'))
      .map((c) => this.card(c));
  }

  async create(input: EventInput): Promise<ApiEvent> {
    if (!input.title || !input.start || !input.end) throw new Error('create needs title, start and end');
    const cal = await this.cal(input.calendar);
    const it = await this.p.google.create(cal.id, this.fields(input, input.allDay));
    this.seen.set(it.id, it); return this.event(it);
  }

  /** Changes only the fields given. A start without an end keeps the event's length. A repeating event changes only this day. */
  async update(id: string, input: EventInput): Promise<ApiEvent> {
    const it = this.find(id);
    const allDay = input.allDay ?? it.allDay, f = this.fields(input, allDay);
    if (f.start && !f.end) f.end = new Date(+f.start + (+it.end - +it.start));
    if (!f.start && f.end) f.start = it.start;
    if (input.allDay !== undefined && !f.start) { f.start = it.start; f.end = it.end; }
    if (f.start) f.allDay = allDay;
    const out = await this.p.google.patch(it, f);
    this.seen.delete(id); this.seen.set(out.id, out); return this.event(out);
  }

  async remove(id: string): Promise<void> { const it = this.find(id); await this.p.google.remove(it); this.seen.delete(id); }

  /** Moves a card to another day: only its `@{date}` changes. board: the board's path; line: the card's line from cards(). */
  async moveCard(board: string, line: number, date: string): Promise<ApiCard> {
    const out = await this.p.kanban.reschedule(this.findCard(board, line), date);
    if (!out) throw new Error('the card was left as it is (it changed on its board, or has two dates)');
    return this.card(out);
  }

  /** Ticks (or with done false, unticks) a card: only its `- [ ]` changes. */
  async tickCard(board: string, line: number, done = true): Promise<ApiCard> {
    const c = this.findCard(board, line);
    await this.p.kanban.setDone(c, done);
    return this.card(this.findCard(board, line));
  }

  // ---------- shapes ----------
  private event(it: Item): ApiEvent {
    return {
      id: it.id, title: it.title, start: local(it.start, it.allDay), end: local(it.allDay ? addDays(it.end, -1) : it.end, it.allDay), allDay: it.allDay,
      calendar: it.calName || '', calendarId: it.g?.cal || '', editable: !!it.editable, recurring: !!it.g?.rec, location: it.location || '', desc: it.desc || '',
    };
  }
  private card(c: Card): ApiCard { return { board: c.path, line: c.line, date: c.date, time: c.time, done: c.done, title: c.title, column: c.column, text: c.raw }; }
  private fields(i: EventInput, allDay = false): GFields {
    const f: GFields = {};
    if (i.title !== undefined) f.title = i.title;
    if (i.desc !== undefined) f.desc = i.desc;
    if (i.location !== undefined) f.location = i.location;
    if (i.colorId !== undefined) f.colorId = i.colorId;
    if (i.start) f.start = when(i.start, 'start');
    if (i.end) f.end = allDay ? addDays(when(i.end, 'end'), 1) : when(i.end, 'end'); // Google's all-day end is the day after
    if (f.start && f.end && !(f.end > f.start)) throw new Error('end must be after start');
    if (f.start || f.end) f.allDay = allDay;
    return f;
  }
  private async cal(nameOrId?: string): Promise<GCal> {
    const g = this.p.google, w = await g.writable();
    const c = !nameOrId ? g.defaultCal(w) : w.find((x) => x.id === nameOrId) || w.find((x) => x.name.toLowerCase() === nameOrId.toLowerCase());
    if (!c) throw new Error('no calendar you can write called ' + (nameOrId || '(default)') + '; see calendars()');
    return c;
  }
  private find(id: string): Item {
    const it = this.seen.get(id);
    if (!it) throw new Error('unknown event ' + id + ': read events() for its day first');
    if (!it.editable) throw new Error('that event is read only for you (' + (it.calName || 'other calendar') + ')');
    return it;
  }
  private findCard(board: string, line: number): Card {
    const c = this.p.kanban.cards().find((x) => x.path === board && x.line === line);
    if (!c) throw new Error('no dated card on line ' + line + ' of ' + board + '; read cards() again');
    return c;
  }
}
