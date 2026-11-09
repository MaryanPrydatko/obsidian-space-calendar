// Google Calendar, read and write, straight from this device (Space does this on its server: src/google.ts there).
// Dormant until a Google OAuth client ID (Desktop app type) is entered in the settings. Sign-in: OAuth with PKCE and a
// loopback redirect (a tiny server on 127.0.0.1 for the one answer), desktop only. The client ID, its secret and the
// tokens are kept per device (app.saveLocalStorage), never in data.json. UNVERIFIED: no client ID existed when this was
// written, so no call here has run against Google yet.
import { Platform, requestUrl } from 'obsidian';
import type { Local } from '../local';
import type { GFields, Item } from '../types';
import { addDays, iso } from '../util';

/** Google's event colours by colorId, with their names there. */
export const COLORS: Record<string, [string, string]> = { 1: ['Lavender', '#7986CB'], 2: ['Sage', '#33B679'], 3: ['Grape', '#8E24AA'], 4: ['Flamingo', '#E67C73'], 5: ['Banana', '#F6BF26'], 6: ['Tangerine', '#F4511E'], 7: ['Peacock', '#039BE5'], 8: ['Graphite', '#616161'], 9: ['Blueberry', '#3F51B5'], 10: ['Basil', '#0B8043'], 11: ['Tomato', '#D50000'] };

const SCOPE = 'https://www.googleapis.com/auth/calendar';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/calendar/v3';

export class GoogleError extends Error { constructor(public status: number, msg?: string) { super(msg || 'google ' + status); } }

interface Tokens { refresh: string; access: string; exp: number; email: string }
/** acct: the signed-in account (its email) the calendar is read and written through. */
export interface GCal { id: string; name: string; color: string; primary: boolean; access: string; acct: string }
const RANK: Record<string, number> = { owner: 3, writer: 2, reader: 1, freeBusyReader: 0 };

const b64url = (b: Uint8Array): string => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = (n: number): string => b64url(crypto.getRandomValues(new Uint8Array(n)));
const form = (d: Record<string, string>): string => new URLSearchParams(d).toString();

export class GoogleSource {
  private cals: GCal[] | null = null; // every account's calendars together, one entry per calendar id
  private span: { a: number; b: number; events: Item[]; at: number } | null = null;
  private st: 'ok' | 'expired' | 'error' = 'ok';
  private loading = false;
  private seq = 0;
  /** Changes sent to Google and not answered yet (null: deleted). A fetch that lands meanwhile keeps them on screen. */
  private pending = new Map<string, Item | null>();
  constructor(private local: Local, private changed: () => void) {}

  // ---------- settings, per device ----------
  clientId(): string { return this.local.get<string>('google-client-id', ''); }
  clientSecret(): string { return this.local.get<string>('google-client-secret', ''); }
  setClient(id: string, secret: string): void { this.local.set('google-client-id', id.trim()); this.local.set('google-client-secret', secret.trim()); }
  // Several Google accounts, each with its own sign-in. The one account of the first version moves into the list.
  private accounts(): Tokens[] {
    const list = this.local.get<Tokens[] | null>('google-accounts', null);
    if (list) return list.filter((t) => t && t.refresh);
    const one = this.local.get<Tokens | null>('google-tokens', null);
    if (one && one.refresh) { this.local.set('google-accounts', [one]); this.local.set('google-tokens', null); return [one]; }
    return [];
  }
  private setAccounts(list: Tokens[]): void { this.local.set('google-accounts', list.length ? list : null); }
  private upsert(t: Tokens): void { const list = this.accounts(), i = list.findIndex((x) => x.email === t.email); if (i >= 0) list[i] = t; else list.push(t); this.setAccounts(list); }
  emails(): string[] { return this.accounts().map((t) => t.email); }
  email(): string { return this.emails().join(', '); }
  configured(): boolean { return !!this.clientId(); }
  connected(): boolean { return this.configured() && this.accounts().length > 0; }
  state(): 'off' | 'ok' | 'expired' | 'error' { return this.connected() ? this.st : this.configured() && this.st === 'expired' ? 'expired' : 'off'; }

  // ---------- sign-in: PKCE with a loopback redirect (desktop only) ----------
  async connect(): Promise<string> {
    if (!Platform.isDesktopApp) throw new Error('Connecting Google works on the desktop app only.');
    const id = this.clientId(); if (!id) throw new Error('Enter the OAuth client ID first.');
    const http = (window as any).require('http'); // Node, only here and only on desktop: the bundle stays mobile-safe
    const verifier = rand(48), state = rand(24);
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const answer = await new Promise<{ code: string; redirect: string }>((resolve, reject) => {
      let redirect = '';
      const server = http.createServer((req: any, res: any) => {
        const u = new URL(req.url || '/', 'http://127.0.0.1');
        const code = u.searchParams.get('code') || '', err = u.searchParams.get('error') || '', st = u.searchParams.get('state') || '';
        if (!code && !err) { res.writeHead(404); res.end(); return; }
        const ok = !!code && st === state;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><meta charset="utf-8"><title>Space Calendar</title><body style="font:16px system-ui;padding:40px">' + (ok ? 'Space Calendar is connected to Google. You can close this tab.' : 'Google did not connect (' + (err || 'state') + '). Try again from Obsidian.') + '</body>');
        clearTimeout(timer); server.close();
        if (ok) resolve({ code, redirect }); else reject(new Error(err === 'access_denied' ? 'Google sign-in was cancelled.' : 'Google sign-in failed: ' + (err || 'state mismatch')));
      });
      const timer = setTimeout(() => { server.close(); reject(new Error('No answer from Google within 5 minutes.')); }, 5 * 60e3);
      server.on('error', (e: Error) => { clearTimeout(timer); reject(e); });
      server.listen(0, '127.0.0.1', () => {
        redirect = 'http://127.0.0.1:' + server.address().port;
        const q = new URLSearchParams({ client_id: id, redirect_uri: redirect, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'select_account consent', code_challenge: challenge, code_challenge_method: 'S256', state });
        window.open(AUTH_URL + '?' + q.toString()); // Obsidian opens it in the system browser
      });
    });
    const body: Record<string, string> = { code: answer.code, client_id: id, redirect_uri: answer.redirect, grant_type: 'authorization_code', code_verifier: verifier };
    if (this.clientSecret()) body.client_secret = this.clientSecret(); // a Desktop client's secret (Google still asks for it)
    const r = await requestUrl({ url: TOKEN_URL, method: 'POST', contentType: 'application/x-www-form-urlencoded', body: form(body), throw: false });
    const j = r.json || {};
    if (r.status >= 400 || !j.access_token) throw new Error('Google refused the sign-in: ' + (j.error_description || j.error || r.status));
    if (!String(j.scope || '').split(' ').includes(SCOPE)) throw new Error('The calendar permission was not ticked. Connect again and tick it.');
    if (!j.refresh_token) throw new Error('Google gave no refresh token. Remove the app at myaccount.google.com/permissions and connect again.');
    // which account this is: its primary calendar's id is its email
    const who = await requestUrl({ url: API + '/users/me/calendarList?minAccessRole=owner&maxResults=250', headers: { Authorization: 'Bearer ' + j.access_token }, throw: false });
    const email = String(((who.status < 400 && who.json?.items) || []).find((c: any) => c.primary)?.id || '');
    if (!email) throw new Error('Google connected, but did not say which account this is. Try again.');
    this.upsert({ refresh: j.refresh_token, access: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000, email });
    this.st = 'ok'; this.cals = null; this.span = null;
    this.changed();
    return email;
  }
  /** Signs one account out (all of them without an email). */
  async disconnect(email?: string): Promise<void> {
    const list = this.accounts(), gone = list.filter((t) => !email || t.email === email);
    for (const t of gone) { try { await requestUrl({ url: REVOKE_URL, method: 'POST', contentType: 'application/x-www-form-urlencoded', body: form({ token: t.refresh || t.access }), throw: false }); } catch { /* forgotten here anyway */ } }
    this.setAccounts(list.filter((t) => !gone.includes(t))); this.cals = null; this.span = null; this.st = 'ok'; this.changed();
  }
  private async token(email: string): Promise<string> {
    const t = this.accounts().find((x) => x.email === email); if (!t || !t.refresh) throw new GoogleError(401, 'not connected');
    if (t.access && t.exp > Date.now() + 60e3) return t.access;
    const body: Record<string, string> = { client_id: this.clientId(), refresh_token: t.refresh, grant_type: 'refresh_token' };
    if (this.clientSecret()) body.client_secret = this.clientSecret();
    const r = await requestUrl({ url: TOKEN_URL, method: 'POST', contentType: 'application/x-www-form-urlencoded', body: form(body), throw: false });
    const j = r.json || {};
    if (r.status >= 400 || !j.access_token) {
      if (j.error === 'invalid_grant') { this.setAccounts(this.accounts().filter((x) => x.email !== email)); this.cals = null; this.st = 'expired'; this.changed(); }
      throw new GoogleError(401, 'refresh failed');
    }
    this.upsert({ ...t, access: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000, refresh: j.refresh_token || t.refresh });
    return j.access_token;
  }
  private async api(acct: string, method: string, path: string, o: { query?: Record<string, string | number | undefined>; body?: unknown; ifMatch?: string } = {}): Promise<any> {
    const u = new URL(API + path);
    for (const [k, v] of Object.entries(o.query || {})) if (v !== undefined) u.searchParams.set(k, String(v));
    const headers: Record<string, string> = { Authorization: 'Bearer ' + (await this.token(acct)) };
    if (o.ifMatch) headers['If-Match'] = o.ifMatch;
    let r;
    try { r = await requestUrl({ url: u.toString(), method, headers, contentType: o.body ? 'application/json' : undefined, body: o.body ? JSON.stringify(o.body) : undefined, throw: false }); }
    catch { throw new GoogleError(0, 'offline'); }
    if (r.status >= 400) throw new GoogleError(r.status);
    if (r.status === 204 || !r.text) return null;
    try { return r.json; } catch { return null; }
  }

  // ---------- calendars and events ----------
  async calendars(): Promise<GCal[]> {
    if (this.cals) return this.cals;
    const byId = new Map<string, GCal>(); let failed: unknown = null;
    await Promise.all(this.emails().map(async (acct) => {
      try {
        let pageToken: string | undefined;
        for (let i = 0; i < 3; i++) {
          const j = await this.api(acct, 'GET', '/users/me/calendarList', { query: { maxResults: 250, pageToken } });
          for (const c of (j && j.items) || []) {
            if (c.deleted) continue;
            const cal = { id: c.id, name: c.summaryOverride || c.summary || c.id, color: c.backgroundColor || '#4C8DF6', primary: !!c.primary, access: c.accessRole || 'none', acct, selected: !!c.selected } as GCal & { selected: boolean };
            // a calendar shared with two of your accounts shows once, through the account that may do the most with it
            const had = byId.get(c.id); if (!had || (RANK[cal.access] ?? 0) > (RANK[had.access] ?? 0)) byId.set(c.id, cal);
          }
          pageToken = j && j.nextPageToken; if (!pageToken) break;
        }
      } catch (e) { failed = e; } // one account failing still shows the others
    }));
    if (!byId.size && failed) throw failed;
    return (this.cals = [...byId.values()]);
  }
  async writable(): Promise<GCal[]> { return (await this.calendars()).filter((c) => c.access === 'owner' || c.access === 'writer'); }
  defaultCal(cals: GCal[]): GCal | undefined { const id = this.local.get<string>('google-default-cal', ''), first = this.emails()[0]; return cals.find((c) => c.id === id) || cals.find((c) => c.primary && c.acct === first) || cals.find((c) => c.primary) || cals[0]; }

  private toItem(e: any, c: GCal): Item {
    const allDay = !!(e.start && e.start.date);
    const start = allDay ? new Date(e.start.date + 'T00:00:00') : new Date(e.start.dateTime);
    let end = allDay ? new Date((e.end?.date || e.start.date) + 'T00:00:00') : new Date(e.end?.dateTime || e.start.dateTime);
    if (!(end > start)) end = new Date(+start + (allDay ? 864e5 : 30 * 60e3));
    const self = !e.organizer || !!e.organizer.self, own = e.colorId && COLORS[e.colorId] ? COLORS[e.colorId][1] : '';
    const video = (e.conferenceData?.entryPoints || []).find((x: any) => x && x.entryPointType === 'video')?.uri || e.hangoutLink || '';
    const desc = typeof e.description === 'string' ? e.description.replace(/<br\s*\/?>|<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() : '';
    return {
      id: 'g:' + c.id + ':' + e.id, title: e.summary || '(no title)', start, end, allDay, color: own || c.color, kind: 'event', src: 'google',
      editable: (c.access === 'owner' || c.access === 'writer') && (self || !!e.guestsCanModify) && !e.locked,
      calName: c.name, location: e.location || '', desc, link: e.htmlLink || '', meet: /^https:\/\//.test(video) ? video : '',
      g: { cal: c.id, id: e.id, etag: e.etag || '', rec: e.recurringEventId || undefined, colorId: e.colorId || '', calColor: c.color },
    };
  }
  items(a: Date, end: Date): Item[] {
    if (!this.connected() || !this.span) return [];
    return this.span.events.filter((it) => it.end > a && it.start < end);
  }
  /** Asks Google for the weeks around a range when the copy here does not cover it or is older than five minutes. */
  ensure(a: Date, end: Date): void {
    if (!this.connected() || this.loading) return;
    const s = this.span, covers = !!s && s.a <= +a && s.b >= +end;
    if (covers && Date.now() - s!.at < 5 * 60e3) return;
    void this.fetch(addDays(a, -14), addDays(end, 14));
  }
  refresh(): void { if (this.span) void this.fetch(new Date(this.span.a), new Date(this.span.b)); }
  private async fetch(a: Date, b: Date): Promise<void> {
    this.loading = true; const n = ++this.seq;
    try {
      const cals = (await this.calendars()).filter((c: any) => c.selected || c.primary).slice(0, 80), out: Item[] = [];
      const res = await Promise.allSettled(cals.map(async (c) => {
        const j = await this.api(c.acct, 'GET', '/calendars/' + encodeURIComponent(c.id) + '/events', { query: { timeMin: a.toISOString(), timeMax: b.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: 2500 } });
        for (const e of (j && j.items) || []) if (e.status !== 'cancelled' && e.start) out.push(this.toItem(e, c));
      }));
      if (n !== this.seq) return; // a change was made meanwhile: its own answer is newer
      const bad = res.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
      if (bad && res.every((r) => r.status === 'rejected')) throw bad.reason;
      for (const [id, v] of this.pending) { const i = out.findIndex((x) => x.id === id); if (v == null) { if (i >= 0) out.splice(i, 1); } else if (i >= 0) out[i] = v; else out.push(v); }
      this.span = { a: +a, b: +b, events: out, at: Date.now() }; this.st = this.st === 'expired' ? 'expired' : 'ok';
    } catch (e) {
      if (e instanceof GoogleError && e.status === 401) this.st = this.connected() ? 'error' : 'expired'; else this.st = 'error';
    } finally { this.loading = false; this.changed(); }
  }
  private body(f: GFields): any {
    const b: any = {};
    if (f.title !== undefined) b.summary = f.title;
    if (f.start && f.end) {
      if (f.allDay) { b.start = { date: iso(f.start), dateTime: null }; b.end = { date: iso(f.end), dateTime: null }; }
      else { b.start = { dateTime: f.start.toISOString(), date: null }; b.end = { dateTime: f.end.toISOString(), date: null }; }
    }
    if (f.colorId !== undefined) b.colorId = f.colorId || null;
    if (f.desc !== undefined) b.description = f.desc;
    if (f.location !== undefined) b.location = f.location;
    return b;
  }
  /** The shown copy changes at once; Google's answer replaces it, or it goes back when Google says no. */
  private swap(id: string, next: Item | null): Item | null {
    if (!this.span) return null;
    const i = this.span.events.findIndex((x) => x.id === id), prev = i >= 0 ? this.span.events[i] : null;
    if (next == null) { if (i >= 0) this.span.events.splice(i, 1); } else if (i >= 0) this.span.events[i] = next; else this.span.events.push(next);
    this.seq++; this.changed();
    return prev;
  }
  async patch(it: Item, f: GFields): Promise<Item> {
    const g = it.g!, cal = (await this.calendars()).find((c) => c.id === g.cal);
    if (!cal) throw new GoogleError(404);
    const shown: Item = { ...it, ...(f.title !== undefined ? { title: f.title } : {}), ...(f.start ? { start: f.start, end: f.end!, allDay: !!f.allDay } : {}), ...(f.location !== undefined ? { location: f.location } : {}), ...(f.desc !== undefined ? { desc: f.desc } : {}) };
    if (f.colorId !== undefined) { shown.color = f.colorId ? COLORS[f.colorId][1] : g.calColor || it.color; shown.g = { ...g, colorId: f.colorId }; }
    const prev = this.swap(it.id, shown); this.pending.set(it.id, shown);
    try {
      const e = await this.api(cal.acct, 'PATCH', '/calendars/' + encodeURIComponent(g.cal) + '/events/' + encodeURIComponent(g.id), { body: this.body(f), ifMatch: g.etag || undefined, query: { sendUpdates: 'none' } });
      const out = this.toItem(e, cal); this.pending.delete(it.id); this.swap(it.id, out); return out;
    } catch (e) { this.pending.delete(it.id); this.swap(it.id, prev); throw e; }
  }
  async create(calId: string, f: GFields): Promise<Item> {
    const cal = (await this.calendars()).find((c) => c.id === calId); if (!cal) throw new GoogleError(404);
    const tmp = 'g:' + calId + ':new-' + Date.now().toString(36);
    const shown: Item = { id: tmp, title: f.title || '', start: f.start!, end: f.end!, allDay: !!f.allDay, color: f.colorId ? COLORS[f.colorId][1] : cal.color, kind: 'event', src: 'google', calName: cal.name, g: { cal: calId, id: '', etag: '' } }; this.swap(tmp, shown); this.pending.set(tmp, shown);
    try {
      const b = this.body(f); if (!b.colorId) delete b.colorId;
      const e = await this.api(cal.acct, 'POST', '/calendars/' + encodeURIComponent(calId) + '/events', { body: b });
      const out = this.toItem(e, cal); this.pending.delete(tmp); this.swap(tmp, null); this.swap(out.id, out); return out;
    } catch (e) { this.pending.delete(tmp); this.swap(tmp, null); throw e; }
  }
  async remove(it: Item): Promise<void> {
    const g = it.g!, cal = (await this.calendars()).find((c) => c.id === g.cal); if (!cal) throw new GoogleError(404);
    const prev = this.swap(it.id, null); this.pending.set(it.id, null);
    try { await this.api(cal.acct, 'DELETE', '/calendars/' + encodeURIComponent(g.cal) + '/events/' + encodeURIComponent(g.id), { ifMatch: g.etag || undefined, query: { sendUpdates: 'none' } }); }
    catch (e) { this.pending.delete(it.id); if (prev) this.swap(it.id, prev); throw e; }
    this.pending.delete(it.id);
  }
}
