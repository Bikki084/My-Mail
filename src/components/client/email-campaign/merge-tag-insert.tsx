"use client";

import * as React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CustomMergeTag } from "@/lib/custom-merge-tags";
import { allMergeTagKeys } from "@/lib/custom-merge-tags";
import { mergeTagSyntax } from "@/lib/merge-tags";
import type { ParsedCsv } from "@/lib/csv-types";

export { mergeTagSyntax };

export function MergeTagInsertMenu({
  lastParsedCsv,
  customMergeTags = [],
  onInsert,
  disabled,
}: {
  lastParsedCsv: ParsedCsv | null;
  customMergeTags?: CustomMergeTag[];
  onInsert: (tag: string) => void;
  disabled?: boolean;
}) {
  const keys = React.useMemo(() => {
    const columns = lastParsedCsv?.columnOrder ?? [];
    const fallback = columns.length === 0 && customMergeTags.length === 0 ? ["name"] : [];
    return allMergeTagKeys(columns.length > 0 ? columns : fallback, customMergeTags).filter(
      (k) => k.toLowerCase() !== "email",
    );
  }, [lastParsedCsv, customMergeTags]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        disabled={disabled}
        className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-700 bg-transparent px-3 text-sm font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
      >
        Insert tag
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-64 overflow-y-auto border-zinc-800 bg-zinc-950 text-zinc-100"
      >
        {keys.map((key) => (
          <DropdownMenuItem
            key={key}
            className="font-mono text-xs text-emerald-400/90 focus:bg-zinc-800 focus:text-emerald-300"
            onSelect={() => onInsert(mergeTagSyntax(key))}
          >
            {mergeTagSyntax(key)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
