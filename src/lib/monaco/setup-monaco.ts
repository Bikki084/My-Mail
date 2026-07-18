import type { Monaco } from "@monaco-editor/react";
import type { languages, Position, editor } from "monaco-editor";
import {
  detectMergeTagAtCursor,
  mergeTagSyntax,
} from "@/lib/merge-tags";
import { BULKFIRE_MONACO_THEME, bulkfireMonacoTheme } from "./bulkfire-theme";

const MONACO_VERSION = "0.55.1";
/** CDN fallback for Monaco web workers when bundled worker URLs are unavailable. */
export const MONACO_CDN_BASE = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`;

let themeRegistered = false;
let loaderConfigured = false;
let workersConfigured = false;

export function configureMonacoLoader(loader: {
  config: (options: {
    paths?: { vs: string };
    monaco?: unknown | (() => Promise<unknown>);
  }) => void;
}) {
  if (loaderConfigured) return;
  loader.config({
    monaco: () => import("monaco-editor"),
  });
  loaderConfigured = true;
}

/** Configure Monaco language workers (required for HTML/CSS token colors). */
export function configureMonacoWorkers() {
  if (typeof window === "undefined" || workersConfigured) return;
  workersConfigured = true;

  const base = MONACO_CDN_BASE;
  window.MonacoEnvironment = {
    getWorker(_workerId, label) {
      if (label === "json") {
        return new Worker(`${base}/language/json/json.worker.js`, { type: "classic" });
      }
      if (label === "css" || label === "scss" || label === "less") {
        return new Worker(`${base}/language/css/css.worker.js`, { type: "classic" });
      }
      if (label === "html" || label === "handlebars" || label === "razor") {
        return new Worker(`${base}/language/html/html.worker.js`, { type: "classic" });
      }
      if (label === "typescript" || label === "javascript") {
        return new Worker(`${base}/language/typescript/ts.worker.js`, { type: "classic" });
      }
      return new Worker(`${base}/editor/editor.worker.js`, { type: "classic" });
    },
  };
}

export function registerBulkfireMonacoTheme(monaco: Monaco) {
  if (themeRegistered) return;
  monaco.editor.defineTheme(BULKFIRE_MONACO_THEME, bulkfireMonacoTheme);
  monaco.languages.html.htmlDefaults.setOptions({
    autoClosingTags: true,
    format: {
      tabSize: 2,
      insertSpaces: true,
      wrapLineLength: 120,
      unformatted: "",
      contentUnformatted: "pre,code,textarea",
      indentInnerHtml: true,
      preserveNewLines: true,
      maxPreserveNewLines: null,
      indentHandlebars: false,
      endWithNewline: false,
      extraLiners: "",
      wrapAttributes: "auto",
    },
  });
  themeRegistered = true;
}

export function registerMergeTagCompletionProvider(
  monaco: Monaco,
  tagKeys: string[],
): { dispose: () => void } {
  return monaco.languages.registerCompletionItemProvider("html", {
    triggerCharacters: ["{", "}"],
    provideCompletionItems(
      model: editor.ITextModel,
      position: Position,
    ): languages.ProviderResult<languages.CompletionList> {
      if (tagKeys.length === 0) {
        return { suggestions: [] };
      }

      const offset = model.getOffsetAt(position);
      const text = model.getValue();
      const hit = detectMergeTagAtCursor(text, offset);

      const word = model.getWordUntilPosition(position);
      const defaultRange = new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn,
      );

      const suggestions = tagKeys
        .filter((key) => {
          if (!hit) return true;
          const q = hit.query.trim().toLowerCase();
          if (!q) return true;
          return key.toLowerCase().includes(q);
        })
        .map((key) => {
          const insertText = mergeTagSyntax(key);
          const range =
            hit != null
              ? (() => {
                  const start = model.getPositionAt(hit.replaceStart);
                  return new monaco.Range(
                    start.lineNumber,
                    start.column,
                    position.lineNumber,
                    position.column,
                  );
                })()
              : defaultRange;

          return {
            label: insertText,
            kind: monaco.languages.CompletionItemKind.Variable,
            insertText,
            detail: "Merge tag",
            range,
            sortText: `0_${key}`,
          };
        });

      return { suggestions };
    },
  });
}

export { BULKFIRE_MONACO_THEME };
