import type { RobotPayload } from './api';
import { CodeEditor } from './editor';
import type { RobotInfo } from './renderer';

export interface RobotPlacement {
    x: number;
    y: number;
    heading?: number;
}

interface RobotMeta {
    name: string;
    team: number;
    color?: string;
}

export interface EditableRobotMeta extends RobotMeta {
    fileName: string;
    isPlayer: boolean;
}

interface FileStoreOptions {
    fileTreeEl: HTMLDivElement;
    editor: CodeEditor;
    onFilesChanged: () => void | Promise<void>;
    canDeleteEnemyBots: () => boolean;
}

export class FileStore {
    private readonly files = new Map<string, string>();
    private readonly placements = new Map<string, RobotPlacement>();
    private readonly robotMeta = new Map<string, RobotMeta>();
    private activeFile: string | null = null;

    constructor(private readonly options: FileStoreOptions) { }

    setFile(name: string, source: string): void {
        this.files.set(name, source);
        this.getOrCreateMeta(name);
    }

    setPlacement(name: string, placement: RobotPlacement): void {
        if (!this.files.has(name)) {
            return;
        }
        this.placements.set(name, placement);
    }

    getPreviewPlacements(): Record<string, RobotPlacement> {
        const placements: Record<string, RobotPlacement> = {};
        for (const [name, placement] of this.placements) {
            const meta = this.getOrCreateMeta(name);
            placements[meta.name] = placement;
        }
        return placements;
    }

    getColorOverrides(): Record<string, string> {
        const overrides: Record<string, string> = {};
        for (const [fileName, meta] of this.robotMeta) {
            if (!this.files.has(fileName) || !meta.color) {
                continue;
            }
            overrides[meta.name] = meta.color;
        }
        return overrides;
    }

    findFileByRobotName(robotName: string): string | null {
        for (const [fileName, meta] of this.robotMeta) {
            if (!this.files.has(fileName)) {
                continue;
            }
            if (meta.name === robotName) {
                return fileName;
            }
        }
        return null;
    }

    getRobotMeta(fileName: string): EditableRobotMeta | null {
        if (!this.files.has(fileName)) {
            return null;
        }
        const meta = this.getOrCreateMeta(fileName);
        return {
            fileName,
            isPlayer: this.isPlayerFile(fileName),
            name: meta.name,
            team: meta.team,
            color: meta.color,
        };
    }

    updateRobotMeta(
        fileName: string,
        updates: { name?: string; team?: number; color?: string | null },
    ): EditableRobotMeta | null {
        if (!this.files.has(fileName)) {
            return null;
        }

        const current = this.getOrCreateMeta(fileName);
        const nextName = updates.name === undefined
            ? current.name
            : this.getUniqueRobotName(fileName, updates.name.trim() || current.name);
        const nextTeam = updates.team === undefined
            ? current.team
            : updates.team === 0
                ? 0
                : 1;
        const nextColor = updates.color === undefined
            ? current.color
            : this.normalizeColor(updates.color);

        this.robotMeta.set(fileName, {
            name: nextName,
            team: nextTeam,
            color: nextColor,
        });
        this.renderFileTree();
        return this.getRobotMeta(fileName);
    }

    saveCurrentFile(): void {
        if (this.activeFile && this.files.has(this.activeFile)) {
            this.files.set(this.activeFile, this.options.editor.getContent());
        }
    }

    switchToFile(filename: string): void {
        this.saveCurrentFile();
        this.activeFile = filename;
        this.options.editor.setContent(this.files.get(filename) || '');
        this.renderFileTree();
    }

    renderFileTree(): void {
        this.options.fileTreeEl.innerHTML = '';

        for (const [name] of this.files) {
            const div = document.createElement('div');
            const isPlayer = name === 'my-bot.ts';
            const team = this.getOrCreateMeta(name).team;
            div.className = `file-item file-team-${team}${name === this.activeFile ? ' active' : ''}`;

            const nameSpan = document.createElement('span');
            nameSpan.className = 'file-name';
            nameSpan.textContent = name;
            div.appendChild(nameSpan);

            if (!isPlayer) {
                const canDelete = this.options.canDeleteEnemyBots();
                const del = document.createElement('span');
                del.className = `file-delete${canDelete ? '' : ' disabled'}`;
                if (!canDelete) {
                    del.title = 'Clear simulation before removing bots';
                }
                del.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
                del.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!this.options.canDeleteEnemyBots()) {
                        return;
                    }
                    this.deleteFile(name);
                });
                div.appendChild(del);
            }

            div.addEventListener('click', () => this.switchToFile(name));
            this.options.fileTreeEl.appendChild(div);
        }
    }

    getRobotInfos(): RobotInfo[] {
        const infos: RobotInfo[] = [];
        for (const [name] of this.files) {
            const meta = this.getOrCreateMeta(name);
            infos.push({
                name: meta.name,
                team: meta.team,
            });
        }
        return infos;
    }

    toRobotPayloads(): RobotPayload[] {
        this.saveCurrentFile();
        const robots: RobotPayload[] = [];
        for (const [name, source] of this.files) {
            const meta = this.getOrCreateMeta(name);
            robots.push({
                name: meta.name,
                source,
                team: meta.team,
                spawn: this.placements.get(name),
            });
        }
        return robots;
    }

    nextBotName(templateName: string): string {
        let count = 1;
        while (this.files.has(`${templateName}-${count}.ts`)) count++;
        return `${templateName}-${count}.ts`;
    }

    private deleteFile(name: string): void {
        this.files.delete(name);
        this.placements.delete(name);
        this.robotMeta.delete(name);

        if (this.activeFile === name) {
            this.switchToFile('my-bot.ts');
        } else {
            this.renderFileTree();
        }

        void Promise.resolve(this.options.onFilesChanged()).catch((err) => {
            console.error('Failed to handle file deletion:', err);
        });
    }

    private isPlayerFile(fileName: string): boolean {
        return fileName === 'my-bot.ts';
    }

    private getOrCreateMeta(fileName: string): RobotMeta {
        const existing = this.robotMeta.get(fileName);
        if (existing) {
            return existing;
        }

        const created: RobotMeta = {
            name: this.getUniqueRobotName(fileName, fileName.replace('.ts', '')),
            team: this.isPlayerFile(fileName) ? 0 : 1,
        };
        this.robotMeta.set(fileName, created);
        return created;
    }

    private getUniqueRobotName(fileName: string, preferredName: string): string {
        const base = preferredName.trim() || fileName.replace('.ts', '');
        const taken = new Set(
            Array.from(this.robotMeta.entries())
                .filter(([otherFile]) => otherFile !== fileName && this.files.has(otherFile))
                .map(([, meta]) => meta.name),
        );
        if (!taken.has(base)) {
            return base;
        }

        let suffix = 2;
        while (taken.has(`${base}-${suffix}`)) {
            suffix++;
        }
        return `${base}-${suffix}`;
    }

    private normalizeColor(color: string | null): string | undefined {
        if (!color) {
            return undefined;
        }
        const value = color.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(value)) {
            return value.toLowerCase();
        }
        return undefined;
    }
}
