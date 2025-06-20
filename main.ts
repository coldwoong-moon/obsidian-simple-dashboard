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

interface Task {
    text: string;
    done: boolean;
    due?: string;
}

interface PluginData {
    settings: DashboardSettings;
    goals: Goal[];
    tasks: Task[];
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

        this.addCommand({
            id: 'add-task',
            name: 'Add Task',
            callback: () => this.addTask()
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
            leaf = workspace.getLeaf(true);
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
    tasks: Task[] = [];

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
        this.tasks = data?.tasks || [];
    }

    async saveSettings() {
        const data: PluginData = { settings: this.settings, goals: this.goals, tasks: this.tasks };
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

    async deleteGoal(index: number) {
        this.goals.splice(index, 1);
        await this.saveSettings();
        this.refreshView();
    }

    async addTask() {
        const text = window.prompt('새 할 일을 입력하세요');
        if (text) {
            this.tasks.push({ text, done: false });
            await this.saveSettings();
            new Notice('할 일이 추가되었습니다');
            this.refreshView();
        }
    }

    async toggleTask(index: number) {
        const t = this.tasks[index];
        if (!t) return;
        t.done = !t.done;
        await this.saveSettings();
        this.refreshView();
    }

    async deleteTask(index: number) {
        this.tasks.splice(index, 1);
        await this.saveSettings();
        this.refreshView();
    }

    refreshView() {
        this.app.workspace
            .getLeavesOfType(VIEW_TYPE)
            .forEach((l) => (l.view as DashboardView).render());
    }

    async calculateDailyStreak(): Promise<number> {
        let streak = 0;
        while (true) {
            const date = moment().subtract(streak, 'day').format('YYYY-MM-DD');
            const path = `${this.settings.dailyNoteFolder}/${date}.md`;
            if (this.app.vault.getAbstractFileByPath(path)) {
                streak++;
            } else {
                break;
            }
        }
        return streak;
    }
}

class DashboardView extends ItemView {
    plugin: DashboardPlugin;
    timeEl: HTMLElement | null = null;
    timeInterval: number | null = null;
    selectedDate: moment.Moment = moment();
    constructor(leaf: any, plugin: DashboardPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return VIEW_TYPE; }
    getDisplayText() { return 'Dashboard'; }

    async onOpen() {
        this.selectedDate = moment();
        await this.render();
        this.timeInterval = window.setInterval(() => this.updateTime(), 1000);
    }

    async onClose() {
        if (this.timeInterval) window.clearInterval(this.timeInterval);
    }

    updateTime() {
        if (this.timeEl) this.timeEl.setText(moment().format('LLLL'));
    }

    async render() {
        const container = this.containerEl.children[1];
        container.empty();

        const grid = container.createDiv({ cls: 'sd-grid' });

        // Date selector
        const dateEl = grid.createDiv({ cls: 'sd-date' });
        const dateInput = dateEl.createEl('input', { type: 'date' });
        dateInput.value = this.selectedDate.format('YYYY-MM-DD');
        dateInput.onchange = async () => {
            this.selectedDate = moment(dateInput.value);
            await this.render();
        };

        // Time section
        const timeWrap = grid.createDiv({ cls: 'sd-time' });
        this.timeEl = timeWrap.createEl('h2', { text: moment().format('LLLL') });

        // Recent notes
        const notesEl = grid.createDiv({ cls: 'sd-notes' });
        notesEl.createEl('h3', { text: 'Recent Notes' });
        const last = this.getLastModified();
        notesEl.createEl('div', { text: `Last note: ${last ? moment(last).fromNow() : 'N/A'}` });
        const todayNotes = await this.getNotesForRange(this.selectedDate.clone().startOf('day'), this.selectedDate.clone().endOf('day'));
        const dayList = notesEl.createEl('ul');
        todayNotes.forEach(n => {
            const li = dayList.createEl('li');
            const link = li.createEl('a', { text: n.basename, href: '#' });
            link.onclick = (e) => { e.preventDefault(); this.app.workspace.getLeaf(true).openFile(n); };
        });

        const weekNotes = await this.getNotesForRange(this.selectedDate.clone().startOf('week'), this.selectedDate.clone().endOf('week'));
        if (weekNotes.length) {
            notesEl.createEl('h4', { text: 'This Week' });
            const weekList = notesEl.createEl('ul');
            weekNotes.forEach(n => {
                const li = weekList.createEl('li');
                const link = li.createEl('a', { text: n.basename, href: '#' });
                link.onclick = (e) => { e.preventDefault(); this.app.workspace.getLeaf(true).openFile(n); };
            });
        }

        const monthNotes = await this.getNotesForRange(this.selectedDate.clone().startOf('month'), this.selectedDate.clone().endOf('month'));
        if (monthNotes.length) {
            notesEl.createEl('h4', { text: 'This Month' });
            const monthList = notesEl.createEl('ul');
            monthNotes.forEach(n => {
                const li = monthList.createEl('li');
                const link = li.createEl('a', { text: n.basename, href: '#' });
                link.onclick = (e) => { e.preventDefault(); this.app.workspace.getLeaf(true).openFile(n); };
            });
        }

        // Stats
        const statsEl = grid.createDiv({ cls: 'sd-stats' });
        statsEl.createEl('h3', { text: 'Stats' });
        statsEl.createDiv({ text: `오늘 작성한 노트: ${todayNotes.length}` });
        statsEl.createDiv({ text: `이번 주 작성한 노트: ${weekNotes.length}` });
        statsEl.createDiv({ text: `이번 달 작성한 노트: ${monthNotes.length}` });
        const streak = await this.plugin.calculateDailyStreak();
        statsEl.createDiv({ text: `데일리 노트 연속 작성일: ${streak}` });

        // Goals
        const goalEl = grid.createDiv({ cls: 'sd-goals' });
        const gHeader = goalEl.createDiv({ cls: 'sd-section-header' });
        gHeader.createEl('h3', { text: 'Goals' });
        const gAdd = gHeader.createEl('button', { text: '+' });
        gAdd.onclick = () => this.plugin.addGoal();
        const goalList = goalEl.createEl('ul');
        this.plugin.goals.forEach((g, i) => {
            const item = goalList.createEl('li');
            const cb = item.createEl('input', { type: 'checkbox' });
            cb.checked = g.done;
            cb.onchange = () => this.plugin.toggleGoal(i);
            item.createEl('span', { text: ` ${g.text}` });
            const del = item.createEl('button', { text: '×', cls: 'sd-remove' });
            del.onclick = () => this.plugin.deleteGoal(i);
        });

        // Tasks
        const taskEl = grid.createDiv({ cls: 'sd-tasks' });
        const tHeader = taskEl.createDiv({ cls: 'sd-section-header' });
        tHeader.createEl('h3', { text: 'Tasks' });
        const tAdd = tHeader.createEl('button', { text: '+' });
        tAdd.onclick = () => this.plugin.addTask();
        const taskList = taskEl.createEl('ul');
        this.plugin.tasks.forEach((t, i) => {
            const item = taskList.createEl('li');
            const cb = item.createEl('input', { type: 'checkbox' });
            cb.checked = t.done;
            cb.onchange = () => this.plugin.toggleTask(i);
            item.createEl('span', { text: ` ${t.text}` });
            const del = item.createEl('button', { text: '×', cls: 'sd-remove' });
            del.onclick = () => this.plugin.deleteTask(i);
        });

        // Events
        const eventsEl = grid.createDiv({ cls: 'sd-events' });
        eventsEl.createEl('h3', { text: 'Events This Week' });
        const events = await this.getEventsForRange(
            this.selectedDate.clone().startOf('week'),
            this.selectedDate.clone().endOf('week')
        );
        const eventList = eventsEl.createEl('ul');
        events.forEach(ev => {
            const time = moment(ev.start).format('MM-DD HH:mm');
            eventList.createEl('li', { text: `${time} ${ev.summary}` });
        });
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

    async getEventsForRange(startDate: moment.Moment, endDate: moment.Moment): Promise<{summary: string; start: Date}[]> {
        const urls = this.plugin.settings.calendarUrls.split(',').map(u => u.trim()).filter(Boolean);
        const events: {summary: string; start: Date}[] = [];
        for (const url of urls) {
            try {
                const data = await ical.async.fromURL(url);
                for (const key in data) {
                    const ev = data[key] as any;
                    if (ev.type === 'VEVENT') {
                        const start = moment(ev.start);
                        if (start.isBetween(startDate, endDate, undefined, '[]')) {
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

