import { App, ItemView, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, FuzzySuggestModal } from 'obsidian';
import moment from 'moment';
import * as ical from 'node-ical';

interface DashboardSettings {
    noteFolders: string[];
    dailyNoteFolder: string;
    calendarUrls: string;
}

interface Goal {
    text: string;
    done: boolean;
    due?: string;
}

interface PluginData {
    settings: DashboardSettings;
    goals: Goal[];
}

const DEFAULT_SETTINGS: DashboardSettings = {
    noteFolders: ['Notes'],
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
            id: 'create-daily-note-for-date',
            name: 'Create Daily Note (Choose Date)',
            callback: () => this.createDailyNoteForDate()
        });

        this.addCommand({
            id: 'create-note-in-folder',
            name: 'Create Note in Dashboard Folder',
            callback: () => this.createNoteInFolder()
        });

        this.addCommand({
            id: 'add-goal',
            name: 'Add Goal',
            callback: () => this.addGoal()
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

    async createDailyNote(date: moment.Moment = moment()) {
        const str = date.format('YYYY-MM-DD');
        await this.ensureFolder(this.settings.dailyNoteFolder);
        const path = `${this.settings.dailyNoteFolder}/${str}.md`;
        if (!this.app.vault.getAbstractFileByPath(path)) {
            await this.app.vault.create(path, `# ${str}`);
        }
        const file = this.app.vault.getAbstractFileByPath(path) as TFile;
        if (file) await this.app.workspace.getLeaf(true).openFile(file);
    }

    async createDailyNoteForDate() {
        const date = await this.pickDate();
        if (date) await this.createDailyNote(date);
    }

    async createNoteInFolder() {
        const folder = await this.selectFolder();
        if (!folder) return;
        const name = moment().format('YYYYMMDDHHmmss');
        await this.ensureFolder(folder);
        const path = `${folder}/${name}.md`;
        await this.app.vault.create(path, `# ${name}`);
        const file = this.app.vault.getAbstractFileByPath(path) as TFile;
        if (file) await this.app.workspace.getLeaf(true).openFile(file);
    }

    async selectFolder(): Promise<string | null> {
        const folders = this.settings.noteFolders;
        if (folders.length === 1) return folders[0];
        return new Promise(resolve => {
            const modal = new FolderSuggestModal(this.app, folders, (f) => resolve(f));
            modal.open();
        });
    }

    async pickDate(): Promise<moment.Moment | null> {
        const options: moment.Moment[] = [];
        for (let i = -7; i <= 7; i++) {
            options.push(moment().add(i, 'day'));
        }
        return new Promise(resolve => {
            const modal = new DateSuggestModal(this.app, options, d => resolve(d));
            modal.open();
        });
    }

    async ensureFolder(folderPath: string) {
        if (this.app.vault.getAbstractFileByPath(folderPath)) return;
        const parts = folderPath.split('/');
        let current = '';
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            if (!this.app.vault.getAbstractFileByPath(current)) {
                await this.app.vault.createFolder(current);
            }
        }
    }

    goals: Goal[] = [];

    async loadSettings() {
        const data = (await this.loadData()) as PluginData | null;
        const loaded = Object.assign({}, DEFAULT_SETTINGS, data?.settings);
        // backward compatibility for old single folder field
        const anyLoaded = loaded as any;
        if (anyLoaded.noteFolder && !anyLoaded.noteFolders) {
            loaded.noteFolders = [anyLoaded.noteFolder];
        }
        this.settings = loaded;
        this.goals = data?.goals || [];
    }

    async saveSettings() {
        const data: PluginData = { settings: this.settings, goals: this.goals };
        await this.saveData(data);
    }

    async addGoal() {
        const text = window.prompt('새 목표를 입력하세요');
        if (text) {
            this.goals.push({ text, done: false });
            await this.saveSettings();
            new Notice('목표가 추가되었습니다');
            this.refreshView();
        }
    }

    async toggleGoal(index: number) {
        const goal = this.goals[index];
        if (!goal) return;
        goal.done = !goal.done;
        await this.saveSettings();
        this.refreshView();
    }

    refreshView() {
        this.app.workspace
            .getLeavesOfType(VIEW_TYPE)
            .forEach((l) => (l.view as DashboardView).render());
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
        await this.render();
    }

    async render() {
        const container = this.containerEl.children[1];
        container.empty();
        container.createEl('h2', { text: 'Dashboard' });

        const last = this.getLastModified();
        container.createEl('div', { text: `Last note: ${last ? moment(last).fromNow() : 'N/A'}` });

        container.createEl('h3', { text: 'Today' });
        const todayNotes = await this.getNotesForRange(moment().startOf('day'), moment().endOf('day'));
        const dayList = container.createEl('ul');
        for (const note of todayNotes) {
            dayList.createEl('li', { text: note.basename });
        }

        const weekNotes = await this.getNotesForRange(moment().startOf('week'), moment().endOf('week'));
        if (weekNotes.length) {
            container.createEl('h3', { text: 'This Week' });
            const weekList = container.createEl('ul');
            for (const note of weekNotes) {
                weekList.createEl('li', { text: note.basename });
            }
        }

        const monthNotes = await this.getNotesForRange(moment().startOf('month'), moment().endOf('month'));
        if (monthNotes.length) {
            container.createEl('h3', { text: 'This Month' });
            const monthList = container.createEl('ul');
            for (const note of monthNotes) {
                monthList.createEl('li', { text: note.basename });
            }
        }

        if (this.plugin.goals.length) {
            container.createEl('h3', { text: 'Goals' });
            const goalList = container.createEl('ul');
            this.plugin.goals.forEach((g, i) => {
                const item = goalList.createEl('li');
                const cb = item.createEl('input', { type: 'checkbox' });
                cb.checked = g.done;
                cb.onchange = () => this.plugin.toggleGoal(i);
                item.createEl('span', { text: ` ${g.text}` });
            });
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

    async getNotesForRange(startDate: moment.Moment, endDate: moment.Moment): Promise<TFile[]> {
        const vault = this.app.vault.getMarkdownFiles();
        const start = startDate.valueOf();
        const end = endDate.valueOf();
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
            .setName('Note folders')
            .setDesc('Comma separated folders for new notes')
            .addTextArea(t => t.setValue(this.plugin.settings.noteFolders.join(', '))
                .onChange(async v => {
                    this.plugin.settings.noteFolders = v.split(',').map(s => s.trim()).filter(Boolean);
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

class FolderSuggestModal extends FuzzySuggestModal<string> {
    onChoose: (folder: string) => void;
    constructor(app: App, private folders: string[], onChoose: (folder: string) => void) {
        super(app);
        this.onChoose = onChoose;
    }
    getItems(): string[] { return this.folders; }
    getItemText(item: string): string { return item; }
    onChooseItem(item: string): void { this.onChoose(item); }
}

class DateSuggestModal extends FuzzySuggestModal<moment.Moment> {
    constructor(app: App, private dates: moment.Moment[], private onChoose: (date: moment.Moment) => void) {
        super(app);
    }
    getItems(): moment.Moment[] { return this.dates; }
    getItemText(item: moment.Moment): string { return item.format('YYYY-MM-DD'); }
    onChooseItem(item: moment.Moment): void { this.onChoose(item); }
}

