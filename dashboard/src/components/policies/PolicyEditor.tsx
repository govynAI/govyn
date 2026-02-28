import {
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  type Ref,
} from "react";
import { EditorView, lineNumbers, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { yaml } from "@codemirror/lang-yaml";
import { bracketMatching, syntaxHighlighting } from "@codemirror/language";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import type { PolicyValidationError } from "@/types/api";

export interface PolicyEditorHandle {
  scrollToLine: (line: number) => void;
}

interface PolicyEditorProps {
  value: string;
  onChange: (value: string) => void;
  errors: PolicyValidationError[];
  readOnly?: boolean;
}

/**
 * CodeMirror 6 YAML editor wrapper with live validation diagnostics.
 *
 * Provides syntax highlighting, line numbers, bracket matching,
 * inline error markers via lintGutter, and a scrollToLine imperative method.
 */
const PolicyEditor = forwardRef(function PolicyEditor(
  { value, onChange, errors, readOnly = false }: PolicyEditorProps,
  ref: Ref<PolicyEditorHandle>,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Track latest value to prevent update loops
  const lastExternalValue = useRef(value);

  useImperativeHandle(ref, () => ({
    scrollToLine(line: number) {
      const view = viewRef.current;
      if (!view) return;
      const docLines = view.state.doc.lines;
      if (line < 1 || line > docLines) return;
      const lineInfo = view.state.doc.line(line);
      view.dispatch({
        selection: { anchor: lineInfo.from },
        scrollIntoView: true,
      });
      view.focus();
    },
  }));

  // Initialize CodeMirror on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const theme = EditorView.theme({
      "&": {
        backgroundColor: "var(--background)",
        color: "var(--foreground)",
        fontSize: "13px",
        fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
      },
      ".cm-content": {
        caretColor: "var(--foreground)",
        padding: "8px 0",
      },
      ".cm-cursor": {
        borderLeftColor: "var(--foreground)",
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
        backgroundColor: "var(--muted)",
      },
      ".cm-gutters": {
        backgroundColor: "var(--muted)",
        color: "var(--muted-foreground)",
        borderRight: "1px solid var(--border)",
        minWidth: "40px",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "var(--accent)",
      },
      ".cm-activeLine": {
        backgroundColor: "color-mix(in srgb, var(--accent) 30%, transparent)",
      },
      ".cm-lint-marker-error": {
        content: '""',
      },
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        yaml(),
        syntaxHighlighting(oneDarkHighlightStyle),
        lineNumbers(),
        bracketMatching(),
        history(),
        highlightSelectionMatches(),
        lintGutter(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        theme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const newVal = update.state.doc.toString();
            lastExternalValue.current = newVal;
            onChange(newVal);
          }
        }),
        EditorState.readOnly.of(readOnly),
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only run on mount/unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external value changes into the editor
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const currentDoc = view.state.doc.toString();
    if (value !== currentDoc && value !== lastExternalValue.current) {
      lastExternalValue.current = value;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }
  }, [value]);

  // Push validation errors as lint diagnostics
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const diagnostics: Diagnostic[] = [];

    for (const error of errors) {
      if (error.line && error.line >= 1 && error.line <= view.state.doc.lines) {
        const lineInfo = view.state.doc.line(error.line);
        diagnostics.push({
          from: lineInfo.from,
          to: lineInfo.to,
          severity: "error",
          message: error.message,
        });
      } else {
        // Errors without a line number show on line 1
        const lineInfo = view.state.doc.line(1);
        diagnostics.push({
          from: lineInfo.from,
          to: lineInfo.to,
          severity: "error",
          message: error.message,
        });
      }
    }

    view.dispatch(setDiagnostics(view.state, diagnostics));
  }, [errors]);

  return (
    <div
      ref={containerRef}
      className="border border-[var(--border)] rounded-lg overflow-hidden min-h-[400px] [&_.cm-editor]:min-h-[400px]"
    />
  );
});

export default PolicyEditor;
