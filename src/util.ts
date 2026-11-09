// Dates, colours and small DOM helpers shared by every part of the calendar. No Obsidian imports here, so tests run in plain Node.

export const iso = (d: Date): string => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const day0 = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Keeps the time of day over a clock change. */
export const shiftDays = (d: Date, n: number): Date => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const hm = (d: Date): string => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
export const sameDay = (a: Date, b: Date): boolean => iso(a) === iso(b);
export const fromIso = (s: string): Date => new Date(s + 'T00:00:00');
export const dayName = (d: Date, w: 'long' | 'short'): string => d.toLocaleDateString('en-GB', { weekday: w, day: 'numeric', month: 'short' });
export const dayShort = (d: Date): string => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
export const daysBetween = (a: Date, b: Date): number => Math.round((+day0(b) - +day0(a)) / 864e5);
/** Rounded to whole minutes first, so 1h 59m 40s reads "2h" and 59.6 min reads "1h". */
export const inMin = (m: number): string => { const r = Math.max(1, Math.round(m)); return r < 60 ? r + ' min' : r < 600 ? Math.floor(r / 60) + 'h' + (r % 60 ? ' ' + String(r % 60).padStart(2, '0') : '') : Math.round(r / 60) + 'h'; };
/** The first day of the week holding d; ws is 1 for Monday, 0 for Sunday. */
export const weekStart = (d: Date, ws: number): Date => addDays(day0(d), -((d.getDay() - ws + 7) % 7));

/** Space's area colours. */
export const AREA: Record<string, string> = { blue: '#4C8DF6', indigo: '#6B7BEF', purple: '#9B6BF2', pink: '#E85FA0', red: '#E5534B', orange: '#F08C3A', yellow: '#D9A92A', lime: '#8BBE3B', green: '#33B679', teal: '#26B5AE', gray: '#8A93A6' };
const PALETTE = ['blue', 'purple', 'green', 'orange', 'pink', 'teal', 'indigo', 'red', 'lime', 'yellow'].map((k) => AREA[k]);
/** A stable colour for a name (a board, a feed), so it keeps its colour between runs. */
export function colorFor(key: string): string {
  let h = 0; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string | null, text?: string | null): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e;
}
