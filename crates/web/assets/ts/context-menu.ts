export interface ContextMenuItem {
    label: string;
    action: () => void;
}

export class ContextMenu {
    private element: HTMLDivElement;

    constructor() {
        this.element = document.createElement("div");
        this.element.className = "context-menu";
        this.element.style.display = "none";
        document.body.appendChild(this.element);
        document.addEventListener("click", () => this.hide());
        document.addEventListener("contextmenu", () => this.hide());

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") this.hide();
        });
    }

    show(x: number, y: number, items: ContextMenuItem[]): void {
        this.element.textContent = '';

        for (const item of items) {
            const row = document.createElement("div");
            row.className = "context-menu-item";
            row.textContent = item.label;

            row.addEventListener("click", (e) => {
                e.stopPropagation();
                this.hide();
                item.action();
            });

            this.element.appendChild(row);
        }

        this.element.style.left = `${x}px`;
        this.element.style.top = `${y}px`;
        this.element.style.display = "block";

        const rect = this.element.getBoundingClientRect();

        if (rect.right > window.innerWidth) {
            this.element.style.left = `${window.innerWidth - rect.width - 4}px`;
        }

        if (rect.bottom > window.innerHeight) {
            this.element.style.top = `${window.innerHeight - rect.height - 4}px`;
        }
    }

    hide(): void {
        this.element.style.display = "none";
    }
}
