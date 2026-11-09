import { requestUrl } from 'obsidian';
import type { Local } from '../local';
import type { Item } from '../types';
import { colorFor } from '../util';
import { parseICS } from './ics-parse';

interface Feed { url: string; name: string; text: string; at: number; error: string }

/** Read-only ICS feeds (Google's secret iCal address and the like). The addresses are per device (they are secrets). */
export class IcsSource {
  private feeds = new Map<string, Feed>();
  private parsed = new Map<string, Item[]>();
  constructor(private local: Local, private changed: () => void) {}

  urls(): string[] { return this.local.get<string[]>('ics-urls', []).filter(Boolean); }
  setUrls(list: string[]): void {
    const clean = [...new Set(list.map((u) => u.trim()).filter(Boolean))];
    this.local.set('ics-urls', clean.length ? clean : null);
    for (const k of [...this.feeds.keys()]) if (!clean.includes(k)) this.feeds.delete(k);
    this.parsed.clear(); this.changed();
  }
  status(): { url: string; name: string; at: number; error: string; count: number }[] {
    return this.urls().map((u) => { const f = this.feeds.get(u); return { url: u, name: f?.name || '', at: f?.at || 0, error: f?.error || '', count: f ? (f.text.match(/BEGIN:VEVENT/g) || []).length : 0 }; });
  }

  /** Fetches the feed's text; an address that cannot be read keeps what was read before. */
  static async fetchText(url: string): Promise<string> {
    const u = url.replace(/^webcal:\/\//i, 'https://');
    const r = await requestUrl({ url: u, method: 'GET', throw: false });
    if (r.status >= 400) throw new Error('HTTP ' + r.status);
    if (!/BEGIN:VCALENDAR/.test(r.text)) throw new Error('not an iCal feed');
    return r.text;
  }
  async refresh(): Promise<void> {
    await Promise.all(this.urls().map(async (url) => {
      const old = this.feeds.get(url);
      try {
        const text = await IcsSource.fetchText(url), name = (/^X-WR-CALNAME:(.*)$/m.exec(text)?.[1] || '').trim() || 'Calendar feed';
        this.feeds.set(url, { url, name, text, at: Date.now(), error: '' });
      } catch (e) {
        this.feeds.set(url, { url, name: old?.name || '', text: old?.text || '', at: old?.at || 0, error: e instanceof Error ? e.message : String(e) });
      }
    }));
    this.parsed.clear(); this.changed();
  }
  items(from: Date, to: Date): Item[] {
    const key = +from + ':' + +to, hit = this.parsed.get(key);
    if (hit) return hit;
    const out: Item[] = [];
    for (const f of this.feeds.values()) {
      if (!f.text) continue;
      const color = colorFor(f.url);
      for (const e of parseICS(f.text, from, to)) out.push({ id: 'i:' + colorFor(f.url) + ':' + e.uid + ':' + +e.start, title: e.title, start: e.start, end: e.end, allDay: e.allDay, color, kind: 'event', src: 'ics', calName: f.name, location: e.location, desc: e.desc, link: e.url });
    }
    if (this.parsed.size > 12) this.parsed.clear();
    this.parsed.set(key, out);
    return out;
  }
}
