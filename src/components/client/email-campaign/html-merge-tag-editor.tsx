"use client";

import * as React from "react";
import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import {
  CodeEditor,
  type CodeEditorHandle,
} from "@/components/editor/code-editor";
import { registerMergeTagCompletionProvider } from "@/lib/monaco/setup-monaco";

export type HtmlMergeTagEditorHandle = CodeEditorHandle;

export type HtmlMergeTagEditorProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  tagKeys: string[];
  placeholder?: string;
  height?: number;
  className?: string;
  disabled?: boolean;
  showToolbar?: boolean;
};

export const HtmlMergeTagEditor = React.forwardRef<
  HtmlMergeTagEditorHandle,
  HtmlMergeTagEditorProps
>(function HtmlMergeTagEditor(
  {
    id,
    value,
    onChange,
    tagKeys,
    placeholder,
    height = 500,
    className,
    disabled,
    showToolbar = true,
  },
  ref,
) {
  const editorRef = React.useRef<CodeEditorHandle>(null);
  const monacoRef = React.useRef<Monaco | null>(null);
  const completionDisposableRef = React.useRef<{ dispose: () => void } | null>(
    null,
  );

  React.useImperativeHandle(ref, () => ({
    insertText(text: string) {
      editorRef.current?.insertText(text);
    },
    focus() {
      editorRef.current?.focus();
    },
    async formatDocument() {
      await editorRef.current?.formatDocument();
    },
  }));

  const registerCompletions = React.useCallback(
    (monaco: Monaco) => {
      completionDisposableRef.current?.dispose();
      completionDisposableRef.current = registerMergeTagCompletionProvider(
        monaco,
        tagKeys,
      );
    },
    [tagKeys],
  );

  const handleMount = React.useCallback(
    (_editor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
      monacoRef.current = monaco;
      registerCompletions(monaco);
    },
    [registerCompletions],
  );

  React.useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    registerCompletions(monaco);
  }, [registerCompletions]);

  React.useEffect(() => {
    return () => {
      completionDisposableRef.current?.dispose();
      completionDisposableRef.current = null;
    };
  }, []);

  return (
    <CodeEditor
      ref={editorRef}
      id={id}
      value={value}
      onChange={onChange}
      language="html"
      height={height}
      className={className}
      placeholder={placeholder}
      disabled={disabled}
      showToolbar={showToolbar}
      onMount={handleMount}
    />
  );
});
