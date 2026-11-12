import { Notice, TFile, type App } from 'obsidian';
import { parseBoard, rewriteDate, rewriteDone, type Card } from './kanban-parse';

/** Every dated card on every Kanban board in the vault, kept up to date as boards change. */
export class KanbanSource {
  private byPath = new Map<string, Card[]>();
  constructor(private app: App, private textTimes: () => boolean, private changed: () => void) {}

  isBoard(f: TFile): boolean {
    if (f.extension !== 'md') return false;
    const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
    return !!fm && fm['kanban-plugin'] != null;
  }
  async scanAll(): Promise<void> {
    this.byPath.clear();
    await Promise.all(this.app.vault.getMarkdownFiles().filter((f) => this.isBoard(f)).map((f) => this.read(f)));
    this.changed();
  }
  private async read(f: TFile): Promise<void> {
    const text = await this.app.vault.cachedRead(f);
    this.byPath.set(f.path, parseBoard(text, f.path, this.textTimes()));
  }
  cards(): Card[] { return [...this.byPath.values()].flat(); }
  boards(): string[] { return [...this.byPath.keys()]; }

  async onChanged(f: TFile): Promise<void> {
    if (this.isBoard(f)) { await this.read(f); this.changed(); }
    else if (this.byPath.delete(f.path)) this.changed();
  }
  onDeleted(path: string): void { if (this.byPath.delete(path)) this.changed(); }
  async onRenamed(f: TFile, old: string): Promise<void> { this.byPath.delete(old); await this.onChanged(f); }

  /** Moves one card to another day: only that card's `@{date}` on that exact line changes. Returns the card as it now
   *  reads (for Undo), or null when it was left alone (a Notice says why). */
  async reschedule(card: Card, to: string): Promise<Card | null> {
    const f = this.app.vault.getAbstractFileByPath(card.path);
    if (!(f instanceof TFile)) { new Notice('Space Calendar: the board ' + card.path + ' is gone.'); return null; }
    try {
      rewriteDate(await this.app.vault.read(f), card.line, card.raw, card.date, to); // checked first, so nothing is written when it would fail
      let line = card.line;
      await this.app.vault.process(f, (data) => {
        const out = rewriteDate(data, card.line, card.raw, card.date, to); // checked again on the text being written
        const a = data.split('\n'), b = out.split('\n'); line = b.findIndex((l, i) => l !== a[i]);
        return out;
      });
      await this.read(f); this.changed();
      const raw = card.raw.replace('@{' + card.date + '}', '@{' + to + '}');
      return this.cards().find((c) => c.path === card.path && c.line === line && c.raw === raw) || { ...card, raw, line, date: to };
    } catch (e) {
      new Notice('Space Calendar: ' + (e instanceof Error ? e.message : String(e)));
      await this.read(f); this.changed();
      return null;
    }
  }

  /** Ticks or unticks one card: only its `- [ ]` on that exact line changes. Throws (and writes nothing) when the line
   *  no longer reads as it did. */
  async setDone(card: Card, done: boolean): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(card.path);
    if (!(f instanceof TFile)) throw new Error('the board ' + card.path + ' is gone');
    try {
      rewriteDone(await this.app.vault.read(f), card.line, card.raw, done); // checked first
      await this.app.vault.process(f, (data) => rewriteDone(data, card.line, card.raw, done));
    } finally { await this.read(f); this.changed(); }
  }
}
