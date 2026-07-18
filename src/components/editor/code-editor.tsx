"use client";

import * as React from "react";
import Editor, { loader, type Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { cn } from "@/lib/utils";
import {
  BULKFIRE_MONACO_THEME,
  configureMonacoLoader,
  configureMonacoWorkers,
  registerBulkfireMonacoTheme,
} from "@/lib/monaco/setup-monaco";

configureMonacoLoader(loader);
configureMonacoWorkers();

const MonacoEditor = React.lazy(async () => ({ default: Editor }));

export type CodeEditorHandle = {
  insertText: (text: string) => void;
  focus: () => void;
  formatDocument: () => Promise<void>;
};

export type CodeEditorProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  language?: string;
  height?: number | string;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  wordWrap?: boolean;
  onWordWrapChange?: (enabled: boolean) => void;
  showToolbar?: boolean;
  onMount?: (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => void;
};

function EditorSkeleton({ height }: { height: number | string }) {
  return (
    <div
      className="flex w-full items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/80"
      style={{ height }}
      aria-hidden
    >
      <div className="flex flex-col items-center gap-2 text-sm text-zinc-500">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" />
        Loading editor…
      </div>
    </div>
  );
}

export const CodeEditor = React.forwardRef<CodeEditorHandle, CodeEditorProps>(
  function CodeEditor(
    {
      id,
      value,
      onChange,
      language = "html",
      height = 500,
      className,
      placeholder,
      disabled = false,
      wordWrap = true,
      onWordWrapChange,
      showToolbar = true,
      onMount,
    },
    ref,
  ) {
    const containerRef = React.useRef<HTMLDivElement>(null);
    const editorRef = React.useRef<editor.IStandaloneCodeEditor | null>(null);
    const monacoRef = React.useRef<Monaco | null>(null);
    const [isVisible, setIsVisible] = React.useState(false);
    const [isEditorReady, setIsEditorReady] = React.useState(false);
    const [wrapEnabled, setWrapEnabled] = React.useState(wordWrap);

    React.useEffect(() => {
      setWrapEnabled(wordWrap);
    }, [wordWrap]);

    React.useEffect(() => {
      const node = containerRef.current;
      if (!node) return;

      if (typeof IntersectionObserver === "undefined") {
        setIsVisible(true);
        return;
      }

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry?.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
          }
        },
        { rootMargin: "120px" },
      );

      observer.observe(node);
      return () => observer.disconnect();
    }, []);

    React.useImperativeHandle(ref, () => ({
      insertText(text: string) {
        const editorInstance = editorRef.current;
        const monaco = monacoRef.current;
        if (!editorInstance || !monaco) {
          onChange(`${value}${text}`);
          return;
        }

        const selection = editorInstance.getSelection();
        if (!selection) {
          onChange(`${value}${text}`);
          return;
        }

        editorInstance.executeEdits("insert-text", [
          {
            range: selection,
            text,
            forceMoveMarkers: true,
          },
        ]);
        editorInstance.focus();
      },
      focus() {
        editorRef.current?.focus();
      },
      async formatDocument() {
        await editorRef.current
          ?.getAction("editor.action.formatDocument")
          ?.run();
      },
    }));

    const handleEditorMount = React.useCallback(
      (editorInstance: editor.IStandaloneCodeEditor, monaco: Monaco) => {
        editorRef.current = editorInstance;
        monacoRef.current = monaco;
        registerBulkfireMonacoTheme(monaco);
        monaco.editor.setTheme(BULKFIRE_MONACO_THEME);
        setIsEditorReady(true);
        onMount?.(editorInstance, monaco);
      },
      [onMount],
    );

    const toggleWordWrap = React.useCallback(() => {
      const next = !wrapEnabled;
      setWrapEnabled(next);
      onWordWrapChange?.(next);
      editorRef.current?.updateOptions({ wordWrap: next ? "on" : "off" });
    }, [onWordWrapChange, wrapEnabled]);

    React.useEffect(() => {
      if (!isEditorReady) return;
      editorRef.current?.updateOptions({
        readOnly: disabled,
        wordWrap: wrapEnabled ? "on" : "off",
      });
    }, [disabled, isEditorReady, wrapEnabled]);

    return (
      <div
        ref={containerRef}
        id={id}
        className={cn(
          "w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/80 shadow-inner",
          className,
        )}
      >
        {showToolbar ? (
          <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/70 px-3 py-2">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              HTML
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleWordWrap}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                  wrapEnabled
                    ? "border-emerald-700/50 bg-emerald-950/40 text-emerald-300"
                    : "border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200",
                )}
              >
                Word wrap {wrapEnabled ? "on" : "off"}
              </button>
              <span className="hidden text-[11px] text-zinc-600 sm:inline">
                Shift+Alt+F format · Ctrl+F search
              </span>
            </div>
          </div>
        ) : null}

        <div className="relative w-full" style={{ height }}>
          {!value && placeholder && !isEditorReady ? (
            <div className="pointer-events-none absolute left-14 top-3 z-10 text-sm text-zinc-500">
              {placeholder}
            </div>
          ) : null}

          {isVisible ? (
            <React.Suspense fallback={<EditorSkeleton height={height} />}>
              <MonacoEditor
                height={typeof height === "number" ? `${height}px` : height}
                language={language}
                theme={BULKFIRE_MONACO_THEME}
                value={value}
                onChange={(next) => onChange(next ?? "")}
                onMount={handleEditorMount}
                loading={<EditorSkeleton height={height} />}
                options={{
                  readOnly: disabled,
                  automaticLayout: true,
                  fontSize: 13,
                  lineHeight: 20,
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
                  tabSize: 2,
                  insertSpaces: true,
                  detectIndentation: false,
                  lineNumbers: "on",
                  lineNumbersMinChars: 3,
                  folding: true,
                  foldingHighlight: true,
                  showFoldingControls: "mouseover",
                  minimap: { enabled: true, scale: 1 },
                  wordWrap: wrapEnabled ? "on" : "off",
                  wordWrapColumn: 120,
                  wrappingIndent: "indent",
                  scrollBeyondLastLine: false,
                  smoothScrolling: true,
                  cursorBlinking: "smooth",
                  cursorSmoothCaretAnimation: "on",
                  renderLineHighlight: "all",
                  bracketPairColorization: { enabled: true },
                  matchBrackets: "always",
                  linkedEditing: true,
                  autoClosingBrackets: "always",
                  autoClosingQuotes: "always",
                  autoClosingOvertype: "always",
                  autoIndent: "full",
                  formatOnPaste: true,
                  formatOnType: false,
                  quickSuggestions: {
                    other: true,
                    strings: true,
                    comments: false,
                  },
                  suggestOnTriggerCharacters: true,
                  acceptSuggestionOnEnter: "on",
                  scrollbar: {
                    verticalScrollbarSize: 10,
                    horizontalScrollbarSize: 10,
                    useShadows: false,
                  },
                  padding: { top: 12, bottom: 12 },
                  overviewRulerLanes: 2,
                  stickyScroll: { enabled: true },
                  ariaLabel: placeholder ?? "HTML code editor",
                }}
              />
            </React.Suspense>
          ) : (
            <EditorSkeleton height={height} />
          )}
        </div>
      </div>
    );
  },
);
