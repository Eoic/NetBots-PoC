export interface ContextMenuItem {
    label: string;
    action: () => void;
}

export class ContextMenu {
    private el: HTMLDivElement;

    constructor() {
        this.el = document.createElement("div");
        this.el.className = "context-menu";
        this.el.style.display = "none";
        document.body.appendChild(this.el);

        document.addEventListener("click", () => this.hide());
        document.addEventListener("contextmenu", () => this.hide());

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") this.hide();
        });
    }

    show(x: number, y: number, items: ContextMenuItem[]): void {
        this.el.textContent = '';

        for (const item of items) {
            const row = document.createElement("div");
            row.className = "context-menu-item";
            row.textContent = item.label;
            row.addEventListener("click", (e) => {
                e.stopPropagation();
                this.hide();
                item.action();
            });
            this.el.appendChild(row);
        }

        this.el.style.left = `${x}px`;
        this.el.style.top = `${y}px`;
        this.el.style.display = "block";

        const rect = this.el.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            this.el.style.left = `${window.innerWidth - rect.width - 4}px`;
        }
        if (rect.bottom > window.innerHeight) {
            this.el.style.top = `${window.innerHeight - rect.height - 4}px`;
        }
    }

    hide(): void {
        this.el.style.display = "none";
    }
}
