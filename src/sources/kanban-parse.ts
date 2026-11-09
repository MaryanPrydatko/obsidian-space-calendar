// Reading Kanban boards (the Kanban plugin's markdown) and changing one card's date. Pure: no Obsidian imports.
// A board: frontmatter `kanban-plugin: board`, `## Column` headings, cards as `- [ ] text @{YYYY-MM-DD}` (optionally
// `@@{HH:mm}`), `- [x]` when done, and a `%% kanban:settings` block at the end.

export interface Card {
  path: string;
  /** 0-based line index in the file, and the line exactly as it was read: a rewrite must find it unchanged. */
  line: number;
  raw: string;
  date: string;
  /** HH:mm from `@@{}`, or (when allowed) from the card text; '' when the card has no time. */
  time: string;
  /** Minutes the card takes when its text says (`to 19:45`, `90 min`); 0 when unknown. */
  mins: number;
  /** Where the time came from: a `@@{}` token or the card text. */
  timeFrom: '' | 'token' | 'text';
  done: boolean;
  title: string;
  column: string;
}

const CARD = /^- \[([ xX])\] (.*)$/;
const DATE_TOKEN = /@\{(\d{4}-\d{2}-\d{2})\}/g;
const TIME_TOKEN = /@@\{(\d{1,2}):(\d{2})\}/;
// "18:00", "08:45", "9:00", "16:30 to 18:45", "12:00-13:30"
const TEXT_TIME = /(^|[\s,(])(\d{1,2}):(\d{2})(?:\s*(?:to|-|–)\s*(\d{1,2}):(\d{2}))?(?=$|[\s,.;)])/;
const TEXT_MINS = /(?:^|[\s,(])(\d{2,3})\s*min\b/;

const pad = (h: number, m: number): string => String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
const okHM = (h: number, m: number): boolean => h >= 0 && h < 24 && m >= 0 && m < 60;

/** What a card shows: its text without the date and time tokens and without links, the time phrase taken out when it gave the time. */
export function cardTitle(text: string, timePhrase?: string): string {
  let t = text.replace(DATE_TOKEN, '').replace(/@@\{[^}]*\}/g, '');
  if (timePhrase) t = t.replace(timePhrase, ' ');
  const links: string[] = [];
  t = t.replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => { links.push(alias || target.replace(/#.*/, '')); return alias ? alias : ''; });
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*|__/g, '');
  t = t.replace(/,\s*([.;])/g, '$1').replace(/\s*,\s*(,\s*)+/g, ', ').replace(/\s+([,.;)])/g, '$1').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim().replace(/^[,;\s]+|[,;\s]+$/g, '');
  return t || links[0] || '(untitled)';
}

/** Every card on a board that has a date. textTimes: also read a time written in the card's text ("18:00 to 19:45"). */
export function parseBoard(text: string, path: string, textTimes: boolean): Card[] {
  const lines = text.split('\n'), out: Card[] = [];
  let i = 0, column = '';
  if (lines[0] !== undefined && lines[0].trim() === '---') { i = 1; while (i < lines.length && lines[i].trim() !== '---') i++; i++; }
  for (; i < lines.length; i++) {
    const raw = lines[i], line = raw.replace(/\r$/, '');
    if (line.startsWith('%% kanban:settings')) break;
    if (/^\*\*\*\s*$/.test(line) || /^## Archive\s*$/.test(line)) break; // the archive: cards put away
    const h = /^## (.*)$/.exec(line); if (h) { column = h[1].trim(); continue; }
    const m = CARD.exec(line); if (!m) continue;
    const body = m[2], dates = [...body.matchAll(DATE_TOKEN)];
    if (!dates.length) continue;
    let time = '', mins = 0, timeFrom: Card['timeFrom'] = '', phrase: string | undefined;
    const tt = TIME_TOKEN.exec(body);
    if (tt && okHM(+tt[1], +tt[2])) { time = pad(+tt[1], +tt[2]); timeFrom = 'token'; }
    else if (textTimes) {
      const x = TEXT_TIME.exec(body.replace(DATE_TOKEN, ''));
      if (x && okHM(+x[2], +x[3])) {
        time = pad(+x[2], +x[3]); timeFrom = 'text'; phrase = x[0].slice(x[1].length);
        if (x[4] && okHM(+x[4], +x[5])) { const d = (+x[4] * 60 + +x[5]) - (+x[2] * 60 + +x[3]); if (d > 0) mins = d; }
      }
    }
    if (time && !mins) { const d = TEXT_MINS.exec(body); if (d && +d[1] >= 5 && +d[1] <= 600) mins = +d[1]; }
    out.push({ path, line: i, raw, date: dates[0][1], time, mins, timeFrom, done: m[1] !== ' ', title: cardTitle(body, phrase), column });
  }
  return out;
}

export class RewriteError extends Error {}

/** The file with one card's date changed, and nothing else. The card's line must still read exactly as it did; when it
 *  moved, it must be the only line that reads so. The line must hold exactly one `@{date}`. Throws RewriteError otherwise. */
export function rewriteDate(data: string, line: number, raw: string, from: string, to: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new RewriteError('Not a date: ' + to);
  const lines = data.split('\n');
  let idx = line;
  if (lines[idx] !== raw) {
    const hits: number[] = []; lines.forEach((l, k) => { if (l === raw) hits.push(k); });
    if (hits.length !== 1) throw new RewriteError(hits.length ? 'That card appears more than once on its board, so it was left as it is.' : 'That card changed on its board since it was read, so it was left as it is.');
    idx = hits[0];
  }
  const tokens = raw.match(DATE_TOKEN) || [];
  if (tokens.length !== 1) throw new RewriteError('That card has ' + tokens.length + ' dates in it, so it was left as it is.');
  if (tokens[0] !== '@{' + from + '}') throw new RewriteError('That card has another date now, so it was left as it is.');
  lines[idx] = raw.replace(tokens[0], '@{' + to + '}');
  return lines.join('\n');
}
