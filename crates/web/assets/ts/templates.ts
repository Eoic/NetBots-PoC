export class TemplateLoader {
    private readonly templateCache = new Map<string, string>();

    async loadTemplate(name: string): Promise<string> {
        if (this.templateCache.has(name)) {
            return this.templateCache.get(name) as string;
        }

        try {
            const resp = await fetch(`/static/templates/${name}.ts`);
            const text = await resp.text();
            this.templateCache.set(name, text);
            return text;
        } catch {
            return `// Failed to load ${name} template`;
        }
    }

    async loadPlayerTemplate(): Promise<string> {
        try {
            const resp = await fetch('/static/robot-template.ts');
            return await resp.text();
        } catch {
            return '// Write your robot code here';
        }
    }
}
