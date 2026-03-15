interface TabControls {
    tabBtns: HTMLButtonElement[];
    cmContainer: HTMLDivElement;
    fileTreePanel: HTMLElement;
    logsContainer: HTMLPreElement;
}

export function setupTabs(controls: TabControls): void {
    controls.tabBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            controls.tabBtns.forEach((tabBtn) => tabBtn.classList.remove('active'));
            btn.classList.add('active');

            const tab = btn.dataset.tab;
            controls.cmContainer.classList.toggle('hidden', tab !== 'code');
            controls.fileTreePanel.classList.toggle('hidden', tab !== 'code');
            controls.logsContainer.classList.toggle('hidden', tab !== 'logs');
        });
    });
}

interface ResizeControls {
    resizeHandle: HTMLDivElement;
    arenaPanel: HTMLDivElement;
    editorOverlay: HTMLDivElement;
}

export function setupEditorResize(controls: ResizeControls): void {
    let isResizing = false;
    let handleCenterOffset = 0;

    const getHandleCenterOffset = (): number => {
        const overlayRect = controls.editorOverlay.getBoundingClientRect();
        const handleRect = controls.resizeHandle.getBoundingClientRect();
        return (handleRect.top + handleRect.height / 2) - overlayRect.top;
    };

    const clampEditorHeight = (): void => {
        const arenaRect = controls.arenaPanel.getBoundingClientRect();
        if (arenaRect.height <= 0) return;

        const minHeight = getHandleCenterOffset();
        const maxHeight = arenaRect.height;
        const currentHeight = controls.editorOverlay.getBoundingClientRect().height;
        const clamped = Math.max(minHeight, Math.min(currentHeight, maxHeight));
        controls.editorOverlay.style.height = `${clamped}px`;
    };

    controls.resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        handleCenterOffset = getHandleCenterOffset();
        controls.resizeHandle.classList.add('is-resizing');
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing)
            return;

        const rect = controls.arenaPanel.getBoundingClientRect();
        const newHeight = rect.bottom - e.clientY + handleCenterOffset;
        const minHeight = handleCenterOffset;
        const maxHeight = rect.height;
        const clamped = Math.max(minHeight, Math.min(newHeight, maxHeight));
        controls.editorOverlay.style.height = `${clamped}px`;
    });

    document.addEventListener('mouseup', () => {
        if (!isResizing) {
            return;
        }

        isResizing = false;
        controls.resizeHandle.classList.remove('is-resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });

    window.addEventListener('resize', clampEditorHeight);
    window.visualViewport?.addEventListener('resize', clampEditorHeight);
    clampEditorHeight();
}

interface FileTreeResizeControls {
    fileTreePanel: HTMLElement;
}

const EDGE_GRAB_ZONE = 4;
const MIN_PANEL_WIDTH = 80;
const MAX_PANEL_WIDTH_RATIO = 0.5;

export function setupFileTreeResize(controls: FileTreeResizeControls): void {
    const panel = controls.fileTreePanel;
    const parent = panel.parentElement!;
    let isResizing = false;

    const isNearRightEdge = (e: MouseEvent): boolean => {
        const rect = panel.getBoundingClientRect();
        return e.clientX >= rect.right - EDGE_GRAB_ZONE && e.clientX <= rect.right + EDGE_GRAB_ZONE;
    };

    parent.addEventListener('mousemove', (e) => {
        if (isResizing) return;

        const near = isNearRightEdge(e);
        panel.classList.toggle('resize-hover', near);
        parent.style.cursor = near ? 'col-resize' : '';
    });

    parent.addEventListener('mouseleave', () => {
        if (isResizing) return;

        panel.classList.remove('resize-hover');
        parent.style.cursor = '';
    });

    parent.addEventListener('mousedown', (e) => {
        if (!isNearRightEdge(e)) return;

        isResizing = true;
        panel.classList.remove('resize-hover');
        panel.classList.add('is-resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const panelRect = panel.getBoundingClientRect();
        const newWidth = e.clientX - panelRect.left;
        const maxWidth = parent.getBoundingClientRect().width * MAX_PANEL_WIDTH_RATIO;
        const clamped = Math.max(MIN_PANEL_WIDTH, Math.min(newWidth, maxWidth));
        panel.style.width = `${clamped}px`;
    });

    document.addEventListener('mouseup', () => {
        if (!isResizing) return;

        isResizing = false;
        panel.classList.remove('is-resizing');
        parent.style.cursor = '';
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });
}
