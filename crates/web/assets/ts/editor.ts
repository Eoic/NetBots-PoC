import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';

function getLanguageExtension(filePath: string): ReturnType<typeof javascript> | [] {
    const ext = filePath.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'ts': return javascript({ typescript: true });
        case 'js': return javascript();
        default: return [];
    }
}

function createEditorState(text: string, filePath: string): EditorState {
    return EditorState.create({
        doc: text,
        extensions: [
            basicSetup,
            getLanguageExtension(filePath),
            oneDark,
            EditorView.theme({
                '&': { height: '100%' },
                '.cm-scroller': { overflow: 'auto' },
            }),
        ],
    });
}

export class CodeEditor {
    private editor: EditorView | null = null;

    constructor(private readonly container: HTMLElement) { }

    create(): void {
        this.editor = new EditorView({
            state: createEditorState('', 'untitled.ts'),
            parent: this.container,
        });
    }

    setContent(text: string, filePath: string = 'untitled.ts'): void {
        if (!this.editor) {
            return;
        }

        this.editor.setState(createEditorState(text, filePath));
    }

    getContent(): string {
        if (!this.editor) {
            return '';
        }

        return this.editor.state.doc.toString();
    }
}
