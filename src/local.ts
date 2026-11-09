import type { App } from 'obsidian';

/** Per-device storage (Obsidian keeps it per vault, on this device only, never in data.json): secrets, feed addresses,
 *  tokens, and what the calendar showed last (view, direction, hour size). */
export class Local {
  constructor(private app: App) {}
  get<T>(k: string, d: T): T {
    try { const v = this.app.loadLocalStorage('space-calendar:' + k); return v == null ? d : (v as T); } catch { return d; }
  }
  set(k: string, v: unknown): void {
    try { this.app.saveLocalStorage('space-calendar:' + k, v == null || v === '' ? null : v); } catch { /* storage blocked: not remembered */ }
  }
}
