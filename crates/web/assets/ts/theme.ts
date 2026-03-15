export type ThemeId = 'terminal-amber' | 'terminal-neon' | 'one-dark';

const STORAGE_KEY = 'netbots-theme';
const DEFAULT_THEME: ThemeId = 'terminal-amber';

function isThemeId(value: string): value is ThemeId {
    return value === 'terminal-amber' || value === 'terminal-neon' || value === 'one-dark';
}

export class ThemeController {
    private theme: ThemeId = DEFAULT_THEME;

    constructor(
        private readonly select: HTMLSelectElement,
        private readonly onThemeChanged: (theme: ThemeId) => Promise<void> | void,
    ) {}

    init(): void {
        const saved = localStorage.getItem(STORAGE_KEY);
        const initial = saved && isThemeId(saved) ? saved : DEFAULT_THEME;
        this.setTheme(initial, false);

        this.select.addEventListener('change', async () => {
            const nextValue = this.select.value;
            if (!isThemeId(nextValue)) {
                this.select.value = this.theme;
                return;
            }

            this.setTheme(nextValue, true);
            await this.onThemeChanged(nextValue);
        });
    }

    getTheme(): ThemeId {
        return this.theme;
    }

    private setTheme(theme: ThemeId, persist: boolean): void {
        this.theme = theme;
        document.documentElement.dataset.theme = theme;
        this.select.value = theme;

        if (persist) {
            localStorage.setItem(STORAGE_KEY, theme);
        }
    }
}
