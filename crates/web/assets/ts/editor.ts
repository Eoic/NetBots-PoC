import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';

function createEditorState(text: string): EditorState {
    return EditorState.create({
        doc: text,
        extensions: [
            basicSetup,
            javascript({ typescript: true }),
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

    constructor(private readonly container: HTMLElement) {}

    create(): void {
        this.editor = new EditorView({
            state: createEditorState(''),
            parent: this.container,
        });
    }

    setContent(text: string): void {
        if (!this.editor) {
            return;
        }
        this.editor.setState(createEditorState(text));
    }

    getContent(): string {
        if (!this.editor) {
            return '';
        }
        return this.editor.state.doc.toString();
    }
}
