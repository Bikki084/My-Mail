"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  detectMergeTagAtCursor,
  mergeTagSyntax,
} from "@/lib/merge-tags";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type MergeTagAutocompleteFieldProps = {
  value: string;
  onChange: (value: string) => void;
  tagKeys: string[];
  multiline?: boolean;
  id?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
};

export function MergeTagAutocompleteField({
  value,
  onChange,
  tagKeys,
  multiline = false,
  id,
  placeholder,
  className,
  disabled,
}: MergeTagAutocompleteFieldProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const getField = () => (multiline ? textareaRef.current : inputRef.current);
  const [open, setOpen] = React.useState(false);
  const [highlight, setHighlight] = React.useState(0);
  const [replaceStart, setReplaceStart] = React.useState(0);
  const [query, setQuery] = React.useState("");

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tagKeys;
    return tagKeys.filter((k) => k.toLowerCase().includes(q));
  }, [tagKeys, query]);

  const syncMenu = React.useCallback(
    (text: string, cursor: number) => {
      if (tagKeys.length === 0) {
        setOpen(false);
        return;
      }
      const hit = detectMergeTagAtCursor(text, cursor);
      if (!hit) {
        setOpen(false);
        return;
      }
      setReplaceStart(hit.replaceStart);
      setQuery(hit.query);
      setHighlight(0);
      setOpen(true);
    },
    [tagKeys.length],
  );

  function insertTag(key: string) {
    const el = getField();
    const cursor = el?.selectionStart ?? value.length;
    const before = value.slice(0, replaceStart);
    const after = value.slice(cursor);
    const insertion = mergeTagSyntax(key);
    const next = before + insertion + after;
    const nextCursor = before.length + insertion.length;
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => {
      const node = getField();
      if (!node) return;
      node.focus();
      node.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const next = e.target.value;
    onChange(next);
    syncMenu(next, e.target.selectionStart ?? next.length);
  }

  function handleSelect(e: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const el = e.currentTarget;
    syncMenu(el.value, el.selectionStart ?? el.value.length);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (!open || filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insertTag(filtered[highlight] ?? filtered[0]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  React.useEffect(() => {
    if (!open) return;
    function onDocMouseDown(ev: MouseEvent) {
      if (!containerRef.current?.contains(ev.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const sharedProps = {
    id,
    value,
    onChange: handleChange,
    onSelect: handleSelect,
    onKeyDown: handleKeyDown,
    onBlur: () => {
      window.setTimeout(() => setOpen(false), 120);
    },
    placeholder,
    disabled,
    autoComplete: "off" as const,
    spellCheck: false,
    autoCorrect: "off" as const,
    autoCapitalize: "off" as const,
    "aria-autocomplete": "list" as const,
    "aria-expanded": open,
  };

  return (
    <div ref={containerRef} className="relative">
      {multiline ? (
        <Textarea
          {...sharedProps}
          ref={textareaRef}
          className={cn("min-h-40 bg-zinc-950/50 font-mono text-sm", className)}
        />
      ) : (
        <Input
          {...sharedProps}
          ref={inputRef}
          type="text"
          className={cn("bg-zinc-950/50", className)}
        />
      )}
      {open && tagKeys.length === 0 ? (
        <p className="absolute z-50 mt-1 w-full rounded-md border border-amber-800/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-200/90">
          Upload a CSV on the Recipients tab to see merge tags here.
        </p>
      ) : null}
      {open && tagKeys.length > 0 ? (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 max-h-48 w-full min-w-[12rem] overflow-y-auto rounded-md border border-zinc-700 bg-zinc-950 py-1 shadow-lg"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-xs text-zinc-500">No matching tags</li>
          ) : (
            filtered.map((key, i) => (
              <li key={key} role="option" aria-selected={i === highlight}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center px-3 py-2 text-left font-mono text-sm",
                    i === highlight
                      ? "bg-emerald-950/60 text-emerald-300"
                      : "text-emerald-400/90 hover:bg-zinc-800",
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertTag(key);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                >
                  {mergeTagSyntax(key)}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
