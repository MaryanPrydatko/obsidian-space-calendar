import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, type WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, type SpaceCalSettings } from './types';
import { Local } from './local';
import { KanbanSource } from './sources/kanban';
import { DailySource } from './sources/daily';
import { IcsSource } from './sources/ics';
import { GoogleSource } from './sources/google';
import { SpaceCalendarView, VIEW_TYPE } from './view';
import { colorFor } from './util';

export default class SpaceCalendarPlugin extends Plugin {
  settings: SpaceCalSettings = { ...DEFAULT_SETTINGS };
  local!: Local;
  kanban!: KanbanSource;
  daily!: DailySource;
  ics!: IcsSource;
  google!: GoogleSource;
  private listeners = new Set<() => void>();

  async onload(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) || {}) };
    this.local = new Local(this.app);
    const changed = () => this.listeners.forEach((f) => f());
    this.kanban = new KanbanSource(this.app, () => this.settings.textTimes, changed);
    this.daily = new DailySource(this.app, () => this.settings.dailyFolder);
    this.ics = new IcsSource(this.local, changed);
    this.google = new GoogleSource(this.local, changed);

    this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => new SpaceCalendarView(leaf, this));
    this.addRibbonIcon('calendar-days', 'Open calendar', () => void this.openCalendar());
    this.addCommand({ id: 'open-calendar', name: 'Open calendar', callback: () => void this.openCalendar() });
    this.addCommand({ id: 'refresh-feeds', name: 'Refresh calendar feeds', callback: () => { void this.ics.refresh(); this.google.refresh(); } });
    this.addSettingTab(new SpaceCalSettingTab(this.app, this));

    const daily = (f: { path: string }) => { if (f.path.startsWith(this.settings.dailyFolder.replace(/\/+$/, '') + '/')) { this.daily.invalidate(); changed(); } };
    this.registerEvent(this.app.metadataCache.on('changed', (f) => void this.kanban.onChanged(f)));
    this.registerEvent(this.app.vault.on('delete', (f) => { this.kanban.onDeleted(f.path); daily(f); }));
    this.registerEvent(this.app.vault.on('rename', (f, old) => { if (f instanceof TFile) void this.kanban.onRenamed(f, old); this.daily.invalidate(); changed(); }));
    this.registerEvent(this.app.vault.on('create', (f) => daily(f)));

    this.app.workspace.onLayoutReady(() => {
      void this.kanban.scanAll();
      void this.ics.refresh();
      this.registerInterval(window.setInterval(() => { void this.ics.refresh(); this.google.refresh(); }, 15 * 60e3));
    });
  }

  onChange(f: () => void): () => void { this.listeners.add(f); return () => this.listeners.delete(f); }
  colorOf(path: string): string { return colorFor(path); }

  /** The calendar in its own tab: the one already open, or a new one. */
  async openCalendar(): Promise<SpaceCalendarView> {
    const ws = this.app.workspace, have = ws.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = have || ws.getLeaf('tab');
    if (!have) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    ws.setActiveLeaf(leaf, { focus: true });
    if (have) await ws.revealLeaf(leaf);
    return leaf.view as SpaceCalendarView;
  }
  async saveSettings(): Promise<void> { await this.saveData(this.settings); this.listeners.forEach((f) => f()); }
}

class SpaceCalSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: SpaceCalendarPlugin) { super(app, plugin); }
  display(): void {
    const { containerEl: c } = this, P = this.plugin, S = P.settings;
    c.empty();
    new Setting(c).setName('Calendar').setHeading();
    new Setting(c).setName('Week starts on').addDropdown((d) => d.addOptions({ 1: 'Monday', 0: 'Sunday' }).setValue(String(S.weekStart)).onChange(async (v) => { S.weekStart = v === '0' ? 0 : 1; await P.saveSettings(); }));
    new Setting(c).setName('Opens in').setDesc('The view a new calendar tab starts in. After that it remembers the last one, on this device.').addDropdown((d) => d.addOptions({ now: 'Now', day: 'Day', week: 'Week', month: 'Month' }).setValue(S.defaultView).onChange(async (v) => { S.defaultView = v as SpaceCalSettings['defaultView']; await P.saveSettings(); }));
    new Setting(c).setName('Daily notes folder').setDesc('Notes named YYYY-MM-DD in this folder show as a marker on their day.').addText((t) => t.setValue(S.dailyFolder).onChange(async (v) => { S.dailyFolder = v.trim() || 'Daily'; P.daily.invalidate(); await P.saveSettings(); }));
    new Setting(c).setName('Read times written in cards').setDesc('A card like "Gym, 18:00 to 19:30 @{2026-11-10}" sits on the hours. Only the date is ever changed on the board. A @@{HH:mm} time always counts.').addToggle((t) => t.setValue(S.textTimes).onChange(async (v) => { S.textTimes = v; await P.saveSettings(); await P.kanban.scanAll(); }));
    new Setting(c).setName('Show done cards').addToggle((t) => t.setValue(S.showDone).onChange(async (v) => { S.showDone = v; await P.saveSettings(); }));

    new Setting(c).setName('Calendar feeds (this device only)').setHeading();
    c.createEl('p', { cls: 'setting-item-description', text: 'One iCal address per line, for example Google Calendar\'s "Secret address in iCal format" (Google Calendar, Settings, your calendar, Integrate calendar). Read only. Kept on this device, not in the synced plugin settings.' });
    const ta = c.createEl('textarea', { cls: 'space-cal-feeds' }); ta.rows = 4; ta.value = P.ics.urls().join('\n'); ta.placeholder = 'https://calendar.google.com/calendar/ical/.../basic.ics';
    ta.style.width = '100%'; ta.spellcheck = false;
    const st = c.createDiv({ cls: 'setting-item-description' });
    const showStatus = () => { st.empty(); for (const f of P.ics.status()) st.createDiv({ text: (f.name || 'Feed') + ': ' + (f.error ? 'error, ' + f.error : f.at ? f.count + ' events, read ' + new Date(f.at).toLocaleTimeString('en-GB') : 'not read yet') }); };
    showStatus();
    new Setting(c).addButton((b) => b.setButtonText('Save and read feeds').setCta().onClick(async () => { P.ics.setUrls(ta.value.split('\n')); await P.ics.refresh(); showStatus(); new Notice('Space Calendar: feeds read.'); }));

    new Setting(c).setName('Google Calendar (this device only)').setHeading();
    c.createEl('p', { cls: 'setting-item-description', text: 'Read and write your Google calendars. Needs an OAuth client of type Desktop app from Google Cloud (see the README). The client ID, secret and sign-in stay on this device.' });
    let id = P.google.clientId(), secret = P.google.clientSecret();
    new Setting(c).setName('OAuth client ID').addText((t) => { t.setValue(id).onChange((v) => { id = v; }); t.inputEl.style.width = '100%'; });
    new Setting(c).setName('OAuth client secret').addText((t) => { t.inputEl.type = 'password'; t.setValue(secret).onChange((v) => { secret = v; }); });
    const g = new Setting(c).setName(P.google.connected() ? 'Connected' + (P.google.email() ? ' as ' + P.google.email() : '') : 'Not connected');
    g.addButton((b) => b.setButtonText(P.google.connected() ? 'Connect again' : 'Save and connect').setCta().onClick(async () => {
      P.google.setClient(id, secret);
      try { const who = await P.google.connect(); new Notice('Space Calendar: Google connected' + (who ? ' as ' + who : '') + '.'); }
      catch (e) { new Notice('Space Calendar: ' + (e instanceof Error ? e.message : String(e)), 8000); }
      this.display();
    }));
    if (P.google.connected()) g.addButton((b) => b.setButtonText('Disconnect').onClick(async () => { await P.google.disconnect(); this.display(); }));
  }
}
