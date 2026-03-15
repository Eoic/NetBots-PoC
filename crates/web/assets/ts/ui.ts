interface TabControls {
    tabBtns: HTMLButtonElement[];
    cmContainer: HTMLDivElement;
    fileTreeEl: HTMLDivElement;
    logsContainer: HTMLPreElement;
}

export function setupTabs(controls: TabControls): void {
    controls.tabBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            controls.tabBtns.forEach((tabBtn) => tabBtn.classList.remove('active'));
            btn.classList.add('active');

            const tab = btn.dataset.tab;
            controls.cmContainer.classList.toggle('hidden', tab !== 'code');
            controls.fileTreeEl.classList.toggle('hidden', tab !== 'code');
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
        if (arenaRect.height <= 0) {
            return;
        }

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
        if (!isResizing) return;
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
