import { TFile, type App } from 'obsidian';

/** Daily notes (`<folder>/YYYY-MM-DD.md`), by date. */
export class DailySource {
  private cache: Map<string, TFile> | null = null;
  constructor(private app: App, private folder: () => string) {}
  invalidate(): void { this.cache = null; }
  dates(): Map<string, TFile> {
    if (this.cache) return this.cache;
    const m = new Map<string, TFile>(), dir = this.folder().replace(/^\/+|\/+$/g, '');
    for (const f of this.app.vault.getMarkdownFiles()) {
      if ((f.parent?.path || '') !== dir || !/^\d{4}-\d{2}-\d{2}$/.test(f.basename)) continue;
      m.set(f.basename, f);
    }
    return (this.cache = m);
  }
}
