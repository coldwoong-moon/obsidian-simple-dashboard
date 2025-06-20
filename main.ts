import { App, ItemView, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from 'obsidian';
import moment from 'moment';
import * as ical from 'node-ical';

interface DashboardSettings {
    noteFolder: string;
    dailyNoteFolder: string;
    calendarUrls: string;
}

const DEFAULT_SETTINGS: DashboardSettings = {
    noteFolder: 'Notes',
    dailyNoteFolder: 'Daily',
    calendarUrls: ''
};

const VIEW_TYPE = 'simple-dashboard-view';

export default class DashboardPlugin extends Plugin {
    settings: DashboardSettings;

    async onload() {
        await this.loadSettings();

        this.addRibbonIcon('calendar-with-checkmark', 'Open Dashboard', () => {
            this.activateView();
        });

        this.addCommand({
            id: 'open-dashboard-view',
            name: 'Open Dashboard',
            callback: () => this.activateView()
        });

        this.addCommand({
            id: 'create-daily-note',
            name: 'Create Daily Note',
            callback: () => this.createDailyNote()
        });

        this.addCommand({
            id: 'create-note-in-folder',
            name: 'Create Note in Dashboard Folder',
            callback: () => this.createNoteInFolder()
        });

        this.registerView(VIEW_TYPE, leaf => new DashboardView(leaf, this));
        this.addSettingTab(new DashboardSettingTab(this.app, this));
    }

    onunload() {
        this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach(l => l.detach());
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf: WorkspaceLeaf | null | undefined = workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (!leaf) {
            leaf = workspace.getRightLeaf(false);
            if (leaf) await leaf.setViewState({ type: VIEW_TYPE, active: true });
        }
        if (leaf) workspace.revealLeaf(leaf);
    }

    async createDailyNote() {
        const date = moment().format('YYYY-MM-DD');
        const path = `${this.settings.dailyNoteFolder}/${date}.md`;
        await this.app.vault.create(path, `# ${date}`);
        const file = this.app.vault.getAbstractFileByPath(path) as TFile;
        if (file) await this.app.workspace.getLeaf(true).openFile(file);
    }

    async createNoteInFolder() {
        const name = moment().format('YYYYMMDDHHmmss');
        const path = `${this.settings.noteFolder}/${name}.md`;
        await this.app.vault.create(path, `# ${name}`);
        const file = this.app.vault.getAbstractFileByPath(path) as TFile;
        if (file) await this.app.workspace.getLeaf(true).openFile(file);
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class DashboardView extends ItemView {
    plugin: DashboardPlugin;
    constructor(leaf: any, plugin: DashboardPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return VIEW_TYPE; }
    getDisplayText() { return 'Dashboard'; }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        const header = container.createEl('h2', { text: 'Dashboard' });

        const last = this.getLastModified();
        container.createEl('div', { text: `Last note: ${last ? moment(last).fromNow() : 'N/A'}` });

        const notes = await this.getNotesForDate(moment());
        const list = container.createEl('ul');
        for (const note of notes) {
            list.createEl('li', { text: note.basename });
        }

        const events = await this.getEventsForDate(moment());
        if (events.length) {
            container.createEl('h3', { text: 'Events' });
            const eventList = container.createEl('ul');
            for (const ev of events) {
                const time = moment(ev.start).format('HH:mm');
                eventList.createEl('li', { text: `${time} ${ev.summary}` });
            }
        }
    }

    async getNotesForDate(date: moment.Moment): Promise<TFile[]> {
        const vault = this.app.vault.getMarkdownFiles();
        const start = date.clone().startOf('day').valueOf();
        const end = date.clone().endOf('day').valueOf();
        let files: TFile[] = [];
        if ((this.app as any).bases) {
            try {
                const bases = (this.app as any).bases;
                const query = `file.ctime >= ${start} && file.ctime <= ${end}`;
                const result = await bases.search(query);
                files = result.files as TFile[];
            } catch (e) {
                console.error('bases search failed', e);
            }
        }
        if (!files.length) {
            files = vault.filter(f => f.stat.ctime >= start && f.stat.ctime <= end);
        }
        return files;
    }

    async getEventsForDate(date: moment.Moment): Promise<{summary: string; start: Date}[]> {
        const urls = this.plugin.settings.calendarUrls.split(',').map(u => u.trim()).filter(Boolean);
        const events: {summary: string; start: Date}[] = [];
        for (const url of urls) {
            try {
                const data = await ical.async.fromURL(url);
                for (const key in data) {
                    const ev = data[key] as any;
                    if (ev.type === 'VEVENT') {
                        const start = moment(ev.start);
                        if (start.isSame(date, 'day')) {
                            events.push({ summary: ev.summary || '', start: ev.start });
                        }
                    }
                }
            } catch (e) {
                console.error('ics fetch failed', e);
            }
        }
        events.sort((a, b) => a.start.getTime() - b.start.getTime());
        return events;
    }

    getLastModified(): number | null {
        const files = this.app.vault.getMarkdownFiles();
        const sorted = files.sort((a, b) => b.stat.mtime - a.stat.mtime);
        return sorted.length ? sorted[0].stat.mtime : null;
    }
}

class DashboardSettingTab extends PluginSettingTab {
    plugin: DashboardPlugin;
    constructor(app: App, plugin: DashboardPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('Note folder')
            .setDesc('Default folder to create notes')
            .addText(t => t.setValue(this.plugin.settings.noteFolder)
                .onChange(async v => {
                    this.plugin.settings.noteFolder = v;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Daily note folder')
            .setDesc('Folder to create daily notes')
            .addText(t => t.setValue(this.plugin.settings.dailyNoteFolder)
                .onChange(async v => {
                    this.plugin.settings.dailyNoteFolder = v;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Calendar URLs')
            .setDesc('Comma separated ICS URLs')
            .addTextArea(t => t.setValue(this.plugin.settings.calendarUrls)
                .onChange(async v => {
                    this.plugin.settings.calendarUrls = v;
                    await this.plugin.saveSettings();
                }));
    }
}

