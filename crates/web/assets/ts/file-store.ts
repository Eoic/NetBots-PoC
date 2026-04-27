import type { RunRequest } from './api';
import { ContextMenu, type ContextMenuItem } from './context-menu';
import { CodeEditor } from './editor';
import type { RobotInfo } from './renderer';
import { buildTree, basename, dirname, joinPath, isDescendant, type TreeNode } from './virtual-fs';

export interface RobotPlacement {
    x: number;
    y: number;
    heading?: number;
}

interface RobotMeta {
    name: string;
    team: number;
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

const MAX_TEAMS = 16;
const DEFAULT_ARENA_WIDTH = 1200;
const DEFAULT_ARENA_HEIGHT = 800;
const ROBOT_RADIUS = 18;
const DEFAULT_HEADING = 0;
const DEFAULT_PLACEMENT_COLS = 4;
const DEFAULT_PLACEMENT_STEP_X = 120;
const DEFAULT_PLACEMENT_STEP_Y = 100;
const DRAG_MIME_TYPE = 'text/x-tree-path';

function createIcon(iconClass: string): HTMLElement {
    const i = document.createElement('i');
    i.className = iconClass;
    i.setAttribute('aria-hidden', 'true');
    return i;
}

function remapSet(set: Set<string>, oldPrefix: string, newPrefix: string): void {
    const toMove: [string, string][] = [];

    for (const entry of set) {
        if (entry === oldPrefix || isDescendant(oldPrefix, entry)) {
            toMove.push([entry, newPrefix + entry.slice(oldPrefix.length)]);
        }
    }

    for (const [oldVal, newVal] of toMove) {
        set.delete(oldVal);
        set.add(newVal);
    }
}

export class FileStore {
    private readonly files = new Map<string, string>();
    private readonly placements = new Map<string, RobotPlacement>();
    private readonly robotMeta = new Map<string, RobotMeta>();
    private readonly entrypoints = new Set<string>();
    private readonly emptyDirs = new Set<string>();
    private readonly collapsedDirs = new Set<string>();
    private readonly contextMenu = new ContextMenu();
    private activeFile: string | null = null;
    private dragGhost: HTMLElement | null = null;
    private dragOffsetX = 0;
    private dragOffsetY = 0;

    constructor(private readonly options: FileStoreOptions) {
        this.options.fileTreeEl.addEventListener('contextmenu', (event) => {
            const target = event.target as HTMLElement;
            const row = target.closest('.tree-row') as HTMLElement | null;

            if (!row) {
                event.preventDefault();
                event.stopPropagation();
                this.showEmptyAreaContextMenu(event.clientX, event.clientY);
            }
        });

        this.setupDropOnRoot();
    }

    setFile(name: string, source: string): void {
        this.files.set(name, source);

        if (this.isEntrypoint(name)) {
            this.getOrCreateMeta(name);
            this.ensurePlacement(name);
        }
    }

    createFile(path: string, content: string = ''): void {
        const parent = dirname(path);
        this.files.set(path, content);

        if (parent) {
            this.emptyDirs.delete(parent);
        }

        this.renderFileTree();
    }

    createDirectory(path: string): void {
        this.emptyDirs.add(path);
        this.renderFileTree();
    }

    renamePath(oldPath: string, newPath: string): void {
        if (oldPath === newPath) return;

        if (this.files.has(oldPath)) {
            this.renameFile(oldPath, newPath);
        } else {
            this.renameDirectory(oldPath, newPath);
        }

        this.renderFileTree();
        this.notifyFilesChanged();
    }

    deletePath(path: string): void {
        if (this.files.has(path)) {
            this.deleteFile(path);
        } else {
            this.deleteDirectory(path);
        }
    }

    markEntrypoint(path: string): void {
        if (!this.files.has(path)) {
            return;
        }

        this.entrypoints.add(path);
        this.getOrCreateMeta(path);
        this.ensurePlacement(path);
        this.renderFileTree();
        this.notifyFilesChanged();
    }

    unmarkEntrypoint(path: string): void {
        this.entrypoints.delete(path);
        this.clearMetadata(path);
        this.renderFileTree();
        this.notifyFilesChanged();
    }

    isEntrypoint(path: string): boolean {
        return this.entrypoints.has(path);
    }

    setPlacement(name: string, placement: RobotPlacement): void {
        if (!this.files.has(name)) return;
        this.placements.set(name, placement);
    }

    getPreviewPlacements(): Record<string, RobotPlacement> {
        for (const path of this.entrypoints) {
            this.ensurePlacement(path);
        }

        const placements: Record<string, RobotPlacement> = {};

        for (const [path, placement] of this.placements) {
            if (!this.entrypoints.has(path)) {
                continue;
            }

            const meta = this.getOrCreateMeta(path);
            placements[meta.name] = placement;
        }

        return placements;
    }

    findFileByRobotName(robotName: string): string | null {
        for (const [fileName, meta] of this.robotMeta) {
            if (!this.files.has(fileName) || !this.entrypoints.has(fileName)) continue;
            if (meta.name === robotName) return fileName;
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
            isPlayer: this.isFirstEntrypoint(fileName),
            name: meta.name,
            team: meta.team,
        };
    }

    updateRobotMeta(
        fileName: string,
        updates: { name?: string; team?: number },
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
            : Math.max(0, Math.min(MAX_TEAMS - 1, updates.team));

        this.robotMeta.set(fileName, { name: nextName, team: nextTeam });
        this.renderFileTree();
        return this.getRobotMeta(fileName);
    }

    saveCurrentFile(): void {
        if (this.activeFile && this.files.has(this.activeFile)) {
            this.files.set(this.activeFile, this.options.editor.getContent());
        }
    }

    switchToFile(filename: string): void {
        if (!this.files.has(filename) || filename === this.activeFile) return;

        this.saveCurrentFile();
        this.activeFile = filename;
        this.options.editor.setContent(this.files.get(filename) || '', filename);
        this.renderFileTree();
    }

    getRobotInfos(): RobotInfo[] {
        const infos: RobotInfo[] = [];

        for (const path of this.entrypoints) {
            if (!this.files.has(path)) continue;
            const meta = this.getOrCreateMeta(path);
            infos.push({ name: meta.name, team: meta.team });
        }

        return infos;
    }

    toRunRequest(maxTicks: number): RunRequest {
        this.saveCurrentFile();

        const files: Record<string, string> = {};

        for (const [path, content] of this.files) {
            files[path] = content;
        }

        const robots = [];

        for (const path of this.entrypoints) {
            if (!this.files.has(path)) {
                continue;
            }

            const meta = this.getOrCreateMeta(path);

            robots.push({
                name: meta.name,
                file: path,
                team: meta.team,
                spawn: this.placements.get(path),
            });
        }

        return { files, robots, max_ticks: maxTicks };
    }

    nextBotName(templateName: string): string {
        let count = 1;
        while (this.files.has(`${templateName}-${count}.ts`)) count++;
        return `${templateName}-${count}.ts`;
    }

    renderFileTree(): void {
        const element = this.options.fileTreeEl;
        element.textContent = '';

        const tree = buildTree(this.files, this.emptyDirs, this.entrypoints);

        for (const node of tree) {
            element.appendChild(this.renderNode(node, 0));
        }

        const emptyArea = document.createElement('div');
        emptyArea.className = 'tree-empty-area';

        emptyArea.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.showEmptyAreaContextMenu(event.clientX, event.clientY);
        });

        element.appendChild(emptyArea);
    }

    promptNewFileAtRoot(): void {
        this.promptNewFile('');
    }

    promptNewFolderAtRoot(): void {
        this.promptNewFolder('');
    }

    private renameFile(oldPath: string, newPath: string): void {
        const content = this.files.get(oldPath)!;
        this.files.delete(oldPath);
        this.files.set(newPath, content);

        if (this.placements.has(oldPath)) {
            this.placements.set(newPath, this.placements.get(oldPath)!);
            this.placements.delete(oldPath);
        }

        if (this.robotMeta.has(oldPath)) {
            const meta = this.robotMeta.get(oldPath)!;
            this.robotMeta.delete(oldPath);
            meta.name = this.getUniqueRobotName(newPath, this.deriveRobotName(newPath));
            this.robotMeta.set(newPath, meta);
        }

        if (this.entrypoints.has(oldPath)) {
            this.entrypoints.delete(oldPath);
            this.entrypoints.add(newPath);
        }

        if (this.activeFile === oldPath) {
            this.activeFile = newPath;
        }
    }

    private renameDirectory(oldPath: string, newPath: string): void {
        if (this.emptyDirs.has(oldPath)) {
            this.emptyDirs.delete(oldPath);
            this.emptyDirs.add(newPath);
        }

        const filesToMove: [string, string][] = [];

        for (const [filePath] of this.files) {
            if (filePath === oldPath || isDescendant(oldPath, filePath)) {
                filesToMove.push([filePath, newPath + filePath.slice(oldPath.length)]);
            }
        }

        for (const [oldFile, newFile] of filesToMove) {
            this.renameFile(oldFile, newFile);
        }

        remapSet(this.emptyDirs, oldPath, newPath);
        remapSet(this.collapsedDirs, oldPath, newPath);
    }

    private deleteFile(path: string): void {
        this.files.delete(path);
        this.clearMetadata(path);
        this.entrypoints.delete(path);

        if (this.activeFile === path) {
            this.switchToFallbackFile();
        }

        this.renderFileTree();
        this.notifyFilesChanged();
    }

    private deleteDirectory(path: string): void {
        const pathsToDelete: string[] = [];

        for (const [filePath] of this.files) {
            if (isDescendant(path, filePath)) {
                pathsToDelete.push(filePath);
            }
        }

        for (const filePath of pathsToDelete) {
            this.files.delete(filePath);
            this.clearMetadata(filePath);
            this.entrypoints.delete(filePath);
        }

        this.emptyDirs.delete(path);

        for (const dir of this.emptyDirs) {
            if (isDescendant(path, dir)) {
                this.emptyDirs.delete(dir);
            }
        }

        this.collapsedDirs.delete(path);

        if (this.activeFile && !this.files.has(this.activeFile)) {
            this.switchToFallbackFile();
        }

        this.renderFileTree();

        if (pathsToDelete.length > 0) {
            this.notifyFilesChanged();
        }
    }

    private switchToFallbackFile(): void {
        const fallback = this.getFirstEntrypoint() ?? this.files.keys().next().value ?? null;

        if (fallback) {
            this.switchToFile(fallback);
        } else {
            this.activeFile = null;
        }
    }

    private clearMetadata(path: string): void {
        this.placements.delete(path);
        this.robotMeta.delete(path);
    }

    private notifyFilesChanged(): void {
        void Promise.resolve(this.options.onFilesChanged()).catch((err) => {
            console.error('onFilesChanged failed:', err);
        });
    }

    private renderNode(node: TreeNode, depth: number): HTMLElement {
        const container = document.createElement('div');
        container.className = 'tree-node';

        const row = document.createElement('div');
        row.className = `tree-row${node.path === this.activeFile ? ' active' : ''}`;
        row.dataset.path = node.path;
        row.style.setProperty('--depth', String(depth));

        if (node.isDirectory) {
            this.renderDirectoryRow(row, node);
        } else {
            this.renderFileRow(row, node);
        }

        container.appendChild(row);

        if (node.isDirectory) {
            const childrenEl = document.createElement('div');
            childrenEl.className = `tree-children${this.collapsedDirs.has(node.path) ? ' collapsed' : ''}`;

            for (const child of node.children) {
                childrenEl.appendChild(this.renderNode(child, depth + 1));
            }

            container.appendChild(childrenEl);
        }

        return container;
    }

    private renderDirectoryRow(row: HTMLElement, node: TreeNode): void {
        const isCollapsed = this.collapsedDirs.has(node.path);

        row.dataset.dir = '';
        this.setupDraggable(row, node);
        this.setupDirectoryDropTarget(row, node);

        const toggle = document.createElement('span');
        toggle.className = `tree-toggle${isCollapsed ? ' collapsed' : ''}`;
        toggle.appendChild(createIcon('fa-solid fa-chevron-down'));
        row.appendChild(toggle);

        const icon = document.createElement('span');
        icon.className = 'tree-icon';
        icon.appendChild(createIcon(`fa-solid ${isCollapsed ? 'fa-folder' : 'fa-folder-open'}`));
        row.appendChild(icon);

        const nameSpan = this.createNameSpan(row, node);
        row.appendChild(nameSpan);

        row.addEventListener('click', () => {
            if (this.collapsedDirs.has(node.path)) {
                this.collapsedDirs.delete(node.path);
            } else {
                this.collapsedDirs.add(node.path);
            }

            this.renderFileTree();
        });

        row.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.showDirectoryContextMenu(event.clientX, event.clientY, node);
        });
    }

    private renderFileRow(row: HTMLElement, node: TreeNode): void {
        this.setupDraggable(row, node);

        const spacer = document.createElement('span');
        spacer.className = 'tree-toggle';
        row.appendChild(spacer);

        const icon = document.createElement('span');
        icon.className = 'tree-icon';

        if (node.isEntrypoint) {
            const meta = this.getOrCreateMeta(node.path);
            icon.appendChild(createIcon('fa-solid fa-robot'));
            icon.style.color = `var(--nb-pixi-team-${meta.team})`;
            row.style.setProperty('--file-team-color', `var(--nb-pixi-team-${meta.team})`);
        } else {
            icon.appendChild(createIcon('fa-solid fa-file-code'));
        }

        row.appendChild(icon);

        const nameSpan = this.createNameSpan(row, node);
        row.appendChild(nameSpan);
        row.addEventListener('click', () => this.switchToFile(node.path));

        row.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.showFileContextMenu(event.clientX, event.clientY, node);
        });
    }

    private createNameSpan(row: HTMLElement, node: TreeNode): HTMLSpanElement {
        const nameSpan = document.createElement('span');
        nameSpan.className = 'tree-name';
        nameSpan.textContent = node.name;

        nameSpan.addEventListener('dblclick', (event) => {
            event.stopPropagation();
            this.startInlineRename(row, node, nameSpan);
        });

        return nameSpan;
    }

    private showFileContextMenu(x: number, y: number, node: TreeNode): void {
        const items: ContextMenuItem[] = [
            { label: 'Rename', action: () => this.promptRename(node) },
        ];

        if (node.isEntrypoint) {
            items.push({
                label: 'Unmark as Robot',
                action: () => this.unmarkEntrypoint(node.path),
            });
        } else {
            items.push({
                label: 'Mark as Robot',
                action: () => this.markEntrypoint(node.path),
            });
        }

        if (!this.isFirstEntrypoint(node.path) && this.options.canDeleteEnemyBots()) {
            items.push({
                label: 'Delete',
                action: () => this.deletePath(node.path),
            });
        }

        this.contextMenu.show(x, y, items);
    }

    private showDirectoryContextMenu(x: number, y: number, node: TreeNode): void {
        const items: ContextMenuItem[] = [
            { label: 'New File', action: () => this.promptNewFile(node.path) },
            { label: 'New Folder', action: () => this.promptNewFolder(node.path) },
            { label: 'Rename', action: () => this.promptRename(node) },
        ];

        if (this.options.canDeleteEnemyBots()) {
            items.push({
                label: 'Delete',
                action: () => this.deletePath(node.path),
            });
        }

        this.contextMenu.show(x, y, items);
    }

    private showEmptyAreaContextMenu(x: number, y: number): void {
        this.contextMenu.show(x, y, [
            { label: 'New File', action: () => this.promptNewFile('') },
            { label: 'New Folder', action: () => this.promptNewFolder('') },
        ]);
    }

    private startInlineRename(row: HTMLElement, node: TreeNode, nameSpan: HTMLElement): void {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tree-rename-input';
        input.value = node.name;
        nameSpan.replaceWith(input);
        input.focus();

        if (!node.isDirectory) {
            const dotIndex = node.name.lastIndexOf('.');
            input.setSelectionRange(0, dotIndex > 0 ? dotIndex : node.name.length);
        } else {
            input.select();
        }

        const commit = (): void => {
            const newName = input.value.trim();
            input.replaceWith(nameSpan);

            if (!newName || newName === node.name) {
                return;
            }

            const parent = dirname(node.path);
            const newPath = parent ? joinPath(parent, newName) : newName;
            this.renamePath(node.path, newPath);
        };

        const cancel = (): void => {
            input.replaceWith(nameSpan);
        };

        input.addEventListener('blur', commit);

        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                input.blur();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                input.removeEventListener('blur', commit);
                cancel();
            }
        });
    }

    private promptRename(node: TreeNode): void {
        this.renderFileTree();

        const row = this.options.fileTreeEl.querySelector(
            `.tree-row[data-path="${CSS.escape(node.path)}"]`,
        ) as HTMLElement | null;

        const nameEl = row?.querySelector('.tree-name') as HTMLElement | null;

        if (row && nameEl) {
            this.startInlineRename(row, node, nameEl);
        }
    }

    private promptNewFile(parentDir: string): void {
        this.showInlineCreationInput(parentDir, 'file');
    }

    private promptNewFolder(parentDir: string): void {
        this.showInlineCreationInput(parentDir, 'directory');
    }

    private showInlineCreationInput(parentDir: string, kind: 'file' | 'directory'): void {
        if (parentDir) {
            this.collapsedDirs.delete(parentDir);
            this.renderFileTree();
        }

        const depth = parentDir ? parentDir.split('/').length : 0;

        const row = document.createElement('div');
        row.className = 'tree-row';
        row.style.setProperty('--depth', String(depth));

        const spacer = document.createElement('span');
        spacer.className = 'tree-toggle';
        row.appendChild(spacer);

        const icon = document.createElement('span');
        icon.className = 'tree-icon';
        icon.appendChild(createIcon(
            kind === 'directory' ? 'fa-solid fa-folder' : 'fa-solid fa-file-code',
        ));
        row.appendChild(icon);

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tree-rename-input';
        input.placeholder = kind === 'directory' ? 'folder name' : 'file name';
        row.appendChild(input);

        const insertionPoint = this.findInsertionPoint(parentDir);
        insertionPoint.container.insertBefore(row, insertionPoint.before);
        input.focus();

        let committed = false;

        const commit = (): void => {
            if (committed) return;
            committed = true;

            const name = input.value.trim();
            row.remove();
            if (!name) return;

            const path = parentDir ? joinPath(parentDir, name) : name;

            if (kind === 'directory') {
                this.createDirectory(path);
            } else {
                this.createFile(path);
                this.switchToFile(path);
            }
        };

        const cancel = (): void => {
            if (committed) return;
            committed = true;
            row.remove();
        };

        input.addEventListener('blur', commit);

        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                input.blur();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                input.removeEventListener('blur', commit);
                cancel();
            }
        });
    }

    private findInsertionPoint(parentDir: string): { container: HTMLElement; before: HTMLElement | null } {
        const el = this.options.fileTreeEl;

        if (!parentDir) {
            const emptyArea = el.querySelector('.tree-empty-area');
            return { container: el, before: emptyArea as HTMLElement | null };
        }

        const dirRow = el.querySelector(`.tree-row[data-path="${CSS.escape(parentDir)}"]`);

        if (dirRow) {
            const treeNode = dirRow.parentElement;
            const childrenEl = treeNode?.querySelector(':scope > .tree-children') as HTMLElement | null;

            if (childrenEl) {
                return { container: childrenEl, before: null };
            }
        }

        const emptyArea = el.querySelector('.tree-empty-area');
        return { container: el, before: emptyArea as HTMLElement | null };
    }

    private setupDraggable(row: HTMLElement, node: TreeNode): void {
        row.draggable = true;

        row.addEventListener('dragstart', (event) => {
            if (!event.dataTransfer) return;

            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData(DRAG_MIME_TYPE, node.path);

            const rect = row.getBoundingClientRect();
            this.dragOffsetX = event.clientX - rect.left;
            this.dragOffsetY = event.clientY - rect.top;

            const blank = document.createElement('canvas');
            blank.width = 1;
            blank.height = 1;
            event.dataTransfer.setDragImage(blank, 0, 0);

            const ghost = row.cloneNode(true) as HTMLElement;
            ghost.classList.remove('active');
            ghost.className = 'tree-row drag-ghost';
            ghost.style.width = `${row.offsetWidth}px`;
            document.body.appendChild(ghost);
            this.dragGhost = ghost;

            row.classList.add('dragging');
        });

        row.addEventListener('drag', (event) => {
            if (!this.dragGhost) return;

            if (event.clientX === 0 && event.clientY === 0) {
                this.dragGhost.style.display = 'none';
                return;
            }

            this.dragGhost.style.display = '';
            this.dragGhost.style.left = `${event.clientX - this.dragOffsetX}px`;
            this.dragGhost.style.top = `${event.clientY - this.dragOffsetY}px`;
        });

        row.addEventListener('dragend', () => {
            row.classList.remove('dragging');
            this.dragGhost?.remove();
            this.dragGhost = null;
            this.clearAllDropTargets();
        });
    }

    private setupDirectoryDropTarget(row: HTMLElement, node: TreeNode): void {
        let dragOverCount = 0;

        row.addEventListener('dragover', (event) => {
            if (!this.hasDragData(event)) return;

            event.preventDefault();

            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = 'move';
            }
        });

        row.addEventListener('dragenter', (event) => {
            if (!this.hasDragData(event)) return;

            event.preventDefault();
            dragOverCount++;
            row.classList.add('drop-target');
        });

        row.addEventListener('dragleave', () => {
            dragOverCount--;

            if (dragOverCount <= 0) {
                dragOverCount = 0;
                row.classList.remove('drop-target');
            }
        });

        row.addEventListener('drop', (event) => {
            event.preventDefault();
            dragOverCount = 0;
            row.classList.remove('drop-target');

            const sourcePath = event.dataTransfer?.getData(DRAG_MIME_TYPE);
            if (!sourcePath || !this.isValidDrop(sourcePath, node.path)) return;

            this.collapsedDirs.delete(node.path);
            this.movePath(sourcePath, node.path);
        });
    }

    private setupDropOnRoot(): void {
        const el = this.options.fileTreeEl;

        const isOverDirectory = (event: DragEvent): boolean => {
            const target = event.target as HTMLElement;
            return !!target.closest('.tree-row[data-dir]');
        };

        el.addEventListener('dragover', (event) => {
            if (isOverDirectory(event)) {
                el.classList.remove('drop-target-root');
                return;
            }

            if (!this.hasDragData(event)) return;

            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
            el.classList.add('drop-target-root');
        });

        el.addEventListener('dragleave', (e) => {
            const related = e.relatedTarget as HTMLElement | null;

            if (!related || !el.contains(related)) {
                el.classList.remove('drop-target-root');
            }
        });

        el.addEventListener('drop', (event) => {
            el.classList.remove('drop-target-root');
            if (isOverDirectory(event)) return;

            event.preventDefault();
            const sourcePath = event.dataTransfer?.getData(DRAG_MIME_TYPE);
            if (!sourcePath || !this.isValidDrop(sourcePath, '')) return;

            this.movePath(sourcePath, '');
        });
    }

    private movePath(sourcePath: string, targetDir: string): void {
        const name = basename(sourcePath);
        const newPath = targetDir ? joinPath(targetDir, name) : name;

        if (sourcePath === newPath) {
            return;
        }

        this.renamePath(sourcePath, newPath);
    }

    private hasDragData(event: DragEvent): boolean {
        return !!event.dataTransfer?.types.includes(DRAG_MIME_TYPE);
    }

    private isValidDrop(sourcePath: string, targetDir: string): boolean {
        if (sourcePath === targetDir) return false;
        if (targetDir && isDescendant(sourcePath, targetDir)) return false;
        if (dirname(sourcePath) === targetDir) return false;
        return true;
    }

    private clearAllDropTargets(): void {
        this.options.fileTreeEl.classList.remove('drop-target-root');

        for (const el of this.options.fileTreeEl.querySelectorAll('.drop-target')) {
            el.classList.remove('drop-target');
        }
    }

    private getFirstEntrypoint(): string | null {
        for (const path of this.entrypoints) {
            if (this.files.has(path)) return path;
        }

        return null;
    }

    private isFirstEntrypoint(path: string): boolean {
        return this.getFirstEntrypoint() === path;
    }

    private deriveRobotName(filePath: string): string {
        return basename(filePath).replace(/\.[^.]+$/, '');
    }

    private getOrCreateMeta(fileName: string): RobotMeta {
        const existing = this.robotMeta.get(fileName);
        if (existing) return existing;

        const created: RobotMeta = {
            name: this.getUniqueRobotName(fileName, this.deriveRobotName(fileName)),
            team: this.isFirstEntrypoint(fileName) || this.entrypoints.size === 0 ? 0 : 1,
        };

        this.robotMeta.set(fileName, created);
        return created;
    }

    private ensurePlacement(fileName: string): void {
        if (!this.files.has(fileName) || this.placements.has(fileName)) return;
        this.placements.set(fileName, this.createDefaultPlacement(this.placements.size));
    }

    private createDefaultPlacement(index: number): RobotPlacement {
        const col = index % DEFAULT_PLACEMENT_COLS;
        const row = Math.floor(index / DEFAULT_PLACEMENT_COLS);
        const baseX = ROBOT_RADIUS + 40 + (col * DEFAULT_PLACEMENT_STEP_X);
        const baseY = ROBOT_RADIUS + 40 + (row * DEFAULT_PLACEMENT_STEP_Y);

        return {
            x: Math.max(ROBOT_RADIUS, Math.min(DEFAULT_ARENA_WIDTH - ROBOT_RADIUS, baseX)),
            y: Math.max(ROBOT_RADIUS, Math.min(DEFAULT_ARENA_HEIGHT - ROBOT_RADIUS, baseY)),
            heading: DEFAULT_HEADING,
        };
    }

    private getUniqueRobotName(fileName: string, preferredName: string): string {
        const base = preferredName.trim() || this.deriveRobotName(fileName);

        const taken = new Set(
            Array.from(this.robotMeta.entries())
                .filter(([otherFile]) => otherFile !== fileName && this.files.has(otherFile))
                .map(([, meta]) => meta.name),
        );

        if (!taken.has(base)) {
            return base;
        }

        let suffix = 2;
        while (taken.has(`${base}-${suffix}`)) suffix++;
        return `${base}-${suffix}`;
    }
}
