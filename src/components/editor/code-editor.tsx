"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import {
  BULKFIRE_MONACO_THEME,
  configureMonacoLoader,
  configureMonacoWorkers,
  registerBulkfireMonacoTheme,
} from "@/lib/monaco/setup-monaco";

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
  onMount?: (editor: unknown, monaco: unknown) => void;
};

type MonacoEditorComponent = React.ComponentType<{
  height?: string | number;
  language?: string;
  theme?: string;
  value?: string;
  onChange?: (value: string | undefined) => void;
  onMount?: (editor: MonacoStandaloneEditor, monaco: MonacoApi) => void;
  loading?: React.ReactNode;
  options?: Record<string, unknown>;
}>;

type MonacoStandaloneEditor = {
  getSelection: () => { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } | null;
  executeEdits: (source: string, edits: Array<{ range: unknown; text: string; forceMoveMarkers?: boolean }>) => void;
  focus: () => void;
  updateOptions: (options: Record<string, unknown>) => void;
  getAction: (id: string) => { run: () => Promise<void> } | null;
};

type MonacoApi = {
  editor: {
    setTheme: (theme: string) => void;
    defineTheme: (name: string, data: unknown) => void;
  };
  Range: new (
    startLineNumber: number,
    startColumn: number,
    endLineNumber: number,
    endColumn: number,
  ) => unknown;
};

function EditorSkeleton({ height }: { height: number | string }) {
  return (
    <div
      className="flex w-full items-center justify-center bg-zinc-950/80"
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

function FallbackTextarea({
  id,
  value,
  onChange,
  height,
  placeholder,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  height: number | string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <Textarea
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      className="w-full resize-y rounded-none border-0 bg-zinc-950/80 font-mono text-sm text-zinc-100 focus-visible:ring-0"
      style={{ height, minHeight: typeof height === "number" ? height : undefined }}
    />
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
    const editorRef = React.useRef<MonacoStandaloneEditor | null>(null);
    const textareaFallbackRef = React.useRef<HTMLTextAreaElement | null>(null);
    const [isVisible, setIsVisible] = React.useState(false);
    const [isEditorReady, setIsEditorReady] = React.useState(false);
    const [wrapEnabled, setWrapEnabled] = React.useState(wordWrap);
    const [MonacoEditor, setMonacoEditor] =
      React.useState<MonacoEditorComponent | null>(null);
    const [loadError, setLoadError] = React.useState<string | null>(null);

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
        { rootMargin: "160px" },
      );

      observer.observe(node);
      return () => observer.disconnect();
    }, []);

    React.useEffect(() => {
      if (!isVisible || MonacoEditor || loadError) return;

      let cancelled = false;

      void (async () => {
        try {
          configureMonacoWorkers();
          const mod = await import("@monaco-editor/react");
          configureMonacoLoader(mod.loader);
          if (!cancelled) {
            setMonacoEditor(() => mod.default as MonacoEditorComponent);
          }
        } catch (err) {
          if (!cancelled) {
            setLoadError(
              err instanceof Error ? err.message : "Failed to load code editor",
            );
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [isVisible, MonacoEditor, loadError]);

    React.useImperativeHandle(ref, () => ({
      insertText(text: string) {
        const editorInstance = editorRef.current;
        if (!editorInstance) {
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
        textareaFallbackRef.current?.focus();
      },
      async formatDocument() {
        await editorRef.current
          ?.getAction("editor.action.formatDocument")
          ?.run();
      },
    }));

    const handleEditorMount = React.useCallback(
      (editorInstance: MonacoStandaloneEditor, monaco: MonacoApi) => {
        editorRef.current = editorInstance;
        registerBulkfireMonacoTheme(monaco as never);
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

    const useFallback = Boolean(loadError);

    return (
      <div
        ref={containerRef}
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
              {!useFallback ? (
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
              ) : null}
              <span className="hidden text-[11px] text-zinc-600 sm:inline">
                {useFallback
                  ? "Plain editor (Monaco unavailable)"
                  : "Shift+Alt+F format · Ctrl+F search"}
              </span>
            </div>
          </div>
        ) : null}

        <div className="relative w-full" style={{ height }}>
          {useFallback ? (
            <FallbackTextarea
              id={id}
              value={value}
              onChange={onChange}
              height={height}
              placeholder={placeholder}
              disabled={disabled}
            />
          ) : isVisible && MonacoEditor ? (
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
          ) : (
            <EditorSkeleton height={height} />
          )}
        </div>
      </div>
    );
  },
);
