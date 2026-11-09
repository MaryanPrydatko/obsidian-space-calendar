// Reading an iCalendar feed (Google's "secret address in iCal format"): VEVENTs with their start and end (all day, UTC,
// floating or with a TZID), title, place and notes, and simple repeats (DAILY, WEEKLY with BYDAY, MONTHLY on the same
// day, YEARLY), with INTERVAL, COUNT, UNTIL, EXDATE and moved single days (RECURRENCE-ID). Pure: no Obsidian imports.

export interface IcsEvent { uid: string; title: string; start: Date; end: Date; allDay: boolean; location: string; desc: string; url: string }

interface Prop { name: string; params: Record<string, string>; value: string }
interface Raw { props: Prop[] }

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}
function parseLine(line: string): Prop | null {
  // NAME;PARAM=a;PARAM="b:c":value
  let i = 0, inQ = false;
  for (; i < line.length; i++) { const c = line[i]; if (c === '"') inQ = !inQ; else if (c === ':' && !inQ) break; }
  if (i >= line.length) return null;
  const head = line.slice(0, i), value = line.slice(i + 1), parts = head.split(';'), params: Record<string, string> = {};
  for (const p of parts.slice(1)) { const eq = p.indexOf('='); if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, ''); }
  return { name: parts[0].toUpperCase(), params, value };
}
const unescape = (s: string): string => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

/** Milliseconds a zone is ahead of UTC at instant t. */
function tzOffset(tz: string, t: number): number {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p: Record<string, number> = {}; for (const x of f.formatToParts(new Date(t))) if (x.type !== 'literal') p[x.type] = +x.value;
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(t / 1000) * 1000;
}
/** A wall-clock time in a zone, as an instant. A zone the system does not know counts as this computer's. */
export function wallToDate(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string | null): Date {
  if (!tz) return new Date(y, mo, d, h, mi, s);
  try {
    const guess = Date.UTC(y, mo, d, h, mi, s);
    let t = guess - tzOffset(tz, guess);
    t = guess - tzOffset(tz, t);
    return new Date(t);
  } catch { return new Date(y, mo, d, h, mi, s); }
}

interface When { allDay: boolean; date: Date; wall: number[]; tz: string | null; utc: boolean }
function parseWhen(p: Prop | undefined): When | null {
  if (!p) return null;
  const v = p.value.trim(), m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const y = +m[1], mo = +m[2] - 1, d = +m[3];
  if (!m[4] || p.params.VALUE === 'DATE') return { allDay: true, date: new Date(y, mo, d), wall: [y, mo, d, 0, 0, 0], tz: null, utc: false };
  const h = +m[4], mi = +m[5], s = +(m[6] || 0);
  if (m[7]) return { allDay: false, date: new Date(Date.UTC(y, mo, d, h, mi, s)), wall: [y, mo, d, h, mi, s], tz: null, utc: true };
  const tz = p.params.TZID || null;
  return { allDay: false, date: wallToDate(y, mo, d, h, mi, s, tz), wall: [y, mo, d, h, mi, s], tz, utc: false };
}
/** The same wall-clock time n days later (in its own zone, so a clock change does not move it). */
function wallPlusDays(w: When, n: number): Date {
  const [y, mo, d, h, mi, s] = w.wall;
  if (w.allDay) return new Date(y, mo, d + n);
  if (w.utc) return new Date(Date.UTC(y, mo, d + n, h, mi, s));
  const c = new Date(Date.UTC(y, mo, d + n));
  return wallToDate(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate(), h, mi, s, w.tz);
}
function parseDuration(v: string): number {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return 0;
  const ms = (((+(m[2] || 0) * 7 + +(m[3] || 0)) * 24 + +(m[4] || 0)) * 60 + +(m[5] || 0)) * 60e3 + +(m[6] || 0) * 1000;
  return m[1] === '-' ? -ms : ms;
}
const dayKey = (d: Date, allDay: boolean): string => allDay ? d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate() : String(+d);

/** The events of a feed that touch [from, to). */
export function parseICS(text: string, from: Date, to: Date): IcsEvent[] {
  const raws: Raw[] = []; let cur: Raw | null = null, depth = 0;
  for (const line of unfold(text)) {
    if (!line) continue;
    if (/^BEGIN:VEVENT$/i.test(line)) { cur = { props: [] }; depth = 0; continue; }
    if (!cur) continue;
    if (/^BEGIN:/i.test(line)) { depth++; continue; } // a VALARM inside the event
    if (/^END:VEVENT$/i.test(line)) { raws.push(cur); cur = null; continue; }
    if (/^END:/i.test(line)) { depth--; continue; }
    if (depth > 0) continue;
    const p = parseLine(line); if (p) cur.props.push(p);
  }
  const get = (r: Raw, n: string) => r.props.find((p) => p.name === n);
  const all = (r: Raw, n: string) => r.props.filter((p) => p.name === n);
  // moved or changed single days of a series: they replace that day of the series
  const moved = new Map<string, Set<string>>();
  for (const r of raws) { const rid = parseWhen(get(r, 'RECURRENCE-ID')), uid = get(r, 'UID')?.value || ''; if (rid && uid) { if (!moved.has(uid)) moved.set(uid, new Set()); moved.get(uid)!.add(dayKey(rid.date, rid.allDay)); } }
  const out: IcsEvent[] = [];
  for (const r of raws) {
    if ((get(r, 'STATUS')?.value || '').toUpperCase() === 'CANCELLED') continue;
    const s = parseWhen(get(r, 'DTSTART')); if (!s) continue;
    const e = parseWhen(get(r, 'DTEND')), dur = get(r, 'DURATION');
    const len = e ? Math.max(0, +e.date - +s.date) : dur ? Math.max(0, parseDuration(dur.value)) : s.allDay ? 864e5 : 0;
    const uid = get(r, 'UID')?.value || '';
    const base = { uid, title: unescape(get(r, 'SUMMARY')?.value || '(no title)'), allDay: s.allDay, location: unescape(get(r, 'LOCATION')?.value || ''), desc: unescape(get(r, 'DESCRIPTION')?.value || ''), url: get(r, 'URL')?.value || '' };
    const push = (st: Date) => {
      // an all-day event keeps whole days across a clock change; a timed one keeps its length
      const en = s.allDay ? new Date(st.getFullYear(), st.getMonth(), st.getDate() + Math.max(1, Math.round(len / 864e5))) : new Date(+st + len);
      if (en > from && st < to) out.push({ ...base, start: st, end: +en > +st ? en : new Date(+st + (s.allDay ? 864e5 : 30 * 60e3)) });
    };
    const rule = get(r, 'RRULE');
    if (!rule || get(r, 'RECURRENCE-ID')) { push(s.date); continue; }
    const rr: Record<string, string> = {}; for (const kv of rule.value.split(';')) { const [k, v] = kv.split('='); if (k && v) rr[k.toUpperCase()] = v; }
    const freq = rr.FREQ, step = Math.max(1, +(rr.INTERVAL || 1)), count = rr.COUNT ? +rr.COUNT : Infinity;
    const until = rr.UNTIL ? parseWhen({ name: 'UNTIL', params: {}, value: rr.UNTIL }) : null;
    const skip = new Set<string>(moved.get(uid) || []);
    for (const ex of all(r, 'EXDATE')) for (const v of ex.value.split(',')) { const w = parseWhen({ ...ex, value: v }); if (w) skip.add(dayKey(w.date, w.allDay)); }
    let n = 0;
    const emit = (st: Date): boolean => { // false: the series is over
      if (until && +st > +until.date + (until.allDay ? 864e5 - 1 : 0)) return false;
      if (++n > count) return false;
      if (!skip.has(dayKey(st, s.allDay))) push(st);
      return +st < +to;
    };
    const [y0, mo0, d0] = s.wall;
    if (freq === 'DAILY') { for (let k = 0; k < 20000; k += step) { if (!emit(wallPlusDays(s, k))) break; } }
    else if (freq === 'WEEKLY') {
      const names = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'], first = new Date(Date.UTC(y0, mo0, d0)).getUTCDay();
      const days = (rr.BYDAY ? rr.BYDAY.split(',').map((x) => names.indexOf(x.replace(/^[+-]?\d+/, ''))).filter((x) => x >= 0) : [first]).sort((a, b) => a - b);
      const wkst = names.indexOf(rr.WKST || 'MO'), weekOf = (first - (wkst < 0 ? 1 : wkst) + 7) % 7; // days from the week's start to DTSTART
      outer: for (let w = 0; w < 5000; w += step) for (const dd of days) {
        const off = w * 7 - weekOf + ((dd - (wkst < 0 ? 1 : wkst) + 7) % 7);
        if (off < 0) continue;
        if (!emit(wallPlusDays(s, off))) break outer;
      }
    } else if (freq === 'MONTHLY' || freq === 'YEARLY') {
      for (let k = 0; k < 3000; k += step) {
        const mo = freq === 'MONTHLY' ? mo0 + k : mo0, y = freq === 'YEARLY' ? y0 + k : y0, probe = new Date(Date.UTC(y, mo, d0));
        if (probe.getUTCDate() !== d0) continue; // no 31st this month, no 29 Feb this year
        const off = Math.round((+probe - Date.UTC(y0, mo0, d0)) / 864e5);
        if (!emit(wallPlusDays(s, off))) break;
      }
    } else push(s.date); // a rule this does not read: the first one only
  }
  return out.sort((a, b) => +a.start - +b.start);
}
