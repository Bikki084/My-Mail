"use client";

import * as React from "react";
import {
  DEFAULT_BUILT_IN_MERGE_TAGS,
  normalizeBuiltInMergeTags,
  type BuiltInMergeTagConfig,
} from "@/lib/built-in-merge-tags";
import { parsedCsvToRecipientRows } from "@/lib/csv-recipients";
import type { ParsedCsv } from "@/lib/csv-types";
import type { RecipientRow } from "@/lib/merge-tags";

const STORAGE_V = 4 as const;
const csvStorageKey = (userId: string) => `mymail.campaign.csv.${STORAGE_V}.${userId}`;
const composeStorageKey = (userId: string) => `mymail.campaign.compose.${STORAGE_V}.${userId}`;

export type AttachmentKind = "pdf" | "png" | "jpeg" | "pdf_image" | null;

export type ComposeDraft = {
  subject: string;
  text: string;
  html: string;
  senderName: string;
  streamName: string;
  encoding: string;
};

export type ComposerUiState = {
  attachmentKind: AttachmentKind;
  attachmentHtml: string;
};

const defaultCompose: ComposeDraft = {
  subject: "Welcome, {{{name}}}",
  text: `Hi {{{name}}},

This is a test from My Mail.`,
  html: `<p>Hi {{{name}}},</p><p><strong>HTML</strong> body.</p>`,
  senderName: "MyMail Campaigns",
  streamName: "",
  encoding: "auto",
};

const defaultComposerUi: ComposerUiState = {
  attachmentKind: null,
  attachmentHtml: "",
};

type EmailCampaignContextValue = {
  campaignRecipients: RecipientRow[];
  lastParsedCsv: ParsedCsv | null;
  builtInMergeTags: BuiltInMergeTagConfig[];
  setBuiltInMergeTags: React.Dispatch<React.SetStateAction<BuiltInMergeTagConfig[]>>;
  setParsedCsvData: (data: ParsedCsv | null) => void;
  clearCampaignRecipients: () => void;
  composeDraft: ComposeDraft;
  setComposeDraft: React.Dispatch<React.SetStateAction<ComposeDraft>>;
  updateCompose: (partial: Partial<ComposeDraft>) => void;
  composerUi: ComposerUiState;
  setComposerUi: React.Dispatch<React.SetStateAction<ComposerUiState>>;
  updateComposerUi: (partial: Partial<ComposerUiState>) => void;
};

const EmailCampaignContext = React.createContext<EmailCampaignContextValue | null>(null);

export function EmailCampaignProvider({
  children,
  persistenceUserId = null,
}: {
  children: React.ReactNode;
  persistenceUserId?: string | null;
}) {
  const [lastParsedCsv, setLastParsedCsv] = React.useState<ParsedCsv | null>(null);
  const [builtInMergeTags, setBuiltInMergeTags] = React.useState<BuiltInMergeTagConfig[]>(
    () => [...DEFAULT_BUILT_IN_MERGE_TAGS],
  );
  const [composeDraft, setComposeDraft] = React.useState<ComposeDraft>({ ...defaultCompose });
  const [composerUi, setComposerUi] = React.useState<ComposerUiState>({ ...defaultComposerUi });
  const [storageReady, setStorageReady] = React.useState(!persistenceUserId);

  const setParsedCsvData = React.useCallback((data: ParsedCsv | null) => {
    setLastParsedCsv(data);
  }, []);

  const clearCampaignRecipients = React.useCallback(() => {
    setLastParsedCsv(null);
    if (persistenceUserId) {
      try {
        localStorage.removeItem(csvStorageKey(persistenceUserId));
      } catch {
        // ignore
      }
    }
  }, [persistenceUserId]);

  const updateCompose = React.useCallback((partial: Partial<ComposeDraft>) => {
    setComposeDraft((d) => ({ ...d, ...partial }));
  }, []);

  const updateComposerUi = React.useCallback((partial: Partial<ComposerUiState>) => {
    setComposerUi((u) => ({ ...u, ...partial }));
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    if (!persistenceUserId) {
      setStorageReady(true);
      return;
    }
    try {
      const rawCsv = localStorage.getItem(csvStorageKey(persistenceUserId));
      if (rawCsv) {
        const p = JSON.parse(rawCsv) as {
          v?: number;
          parsed?: ParsedCsv;
          builtInMergeTags?: BuiltInMergeTagConfig[];
        };
        if (p.v === STORAGE_V && p.parsed?.columnOrder && Array.isArray(p.parsed.rows)) {
          setLastParsedCsv(p.parsed);
        }
        if (p.v === STORAGE_V && Array.isArray(p.builtInMergeTags)) {
          setBuiltInMergeTags(normalizeBuiltInMergeTags(p.builtInMergeTags));
        }
      }
      const rawCompose = localStorage.getItem(composeStorageKey(persistenceUserId));
      if (rawCompose) {
        const c = JSON.parse(rawCompose) as {
          v?: number;
          compose?: ComposeDraft;
          composerUi?: ComposerUiState;
        };
        if (c.v === STORAGE_V && c.compose) {
          setComposeDraft({ ...defaultCompose, ...c.compose });
        }
        if (c.v === STORAGE_V && c.composerUi) {
          setComposerUi({
            ...defaultComposerUi,
            attachmentKind: c.composerUi.attachmentKind ?? null,
            attachmentHtml: c.composerUi.attachmentHtml ?? "",
          });
        }
      }
    } catch {
      // ignore
    } finally {
      setStorageReady(true);
    }
  }, [persistenceUserId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  React.useEffect(() => {
    if (!persistenceUserId || !storageReady) return;
    try {
      localStorage.setItem(
        csvStorageKey(persistenceUserId),
        JSON.stringify({
          v: STORAGE_V,
          parsed: lastParsedCsv,
          builtInMergeTags,
          savedAt: Date.now(),
        }),
      );
    } catch {
      // ignore
    }
  }, [lastParsedCsv, builtInMergeTags, persistenceUserId, storageReady]);

  React.useEffect(() => {
    if (!persistenceUserId || !storageReady) return;
    try {
      localStorage.setItem(
        composeStorageKey(persistenceUserId),
        JSON.stringify({
          v: STORAGE_V,
          compose: composeDraft,
          composerUi,
          savedAt: Date.now(),
        }),
      );
    } catch {
      // ignore
    }
  }, [composeDraft, composerUi, persistenceUserId, storageReady]);

  const campaignRecipients = React.useMemo(
    () => parsedCsvToRecipientRows(lastParsedCsv, builtInMergeTags),
    [lastParsedCsv, builtInMergeTags],
  );

  const value = React.useMemo(
    () =>
      ({
        campaignRecipients,
        lastParsedCsv,
        builtInMergeTags,
        setBuiltInMergeTags,
        setParsedCsvData,
        clearCampaignRecipients,
        composeDraft,
        setComposeDraft,
        updateCompose,
        composerUi,
        setComposerUi,
        updateComposerUi,
      }) satisfies EmailCampaignContextValue,
    [
      campaignRecipients,
      lastParsedCsv,
      builtInMergeTags,
      setParsedCsvData,
      clearCampaignRecipients,
      composeDraft,
      updateCompose,
      composerUi,
      updateComposerUi,
    ],
  );

  return (
    <EmailCampaignContext.Provider value={value}>{children}</EmailCampaignContext.Provider>
  );
}

export function useEmailCampaign() {
  const ctx = React.useContext(EmailCampaignContext);
  if (!ctx) {
    throw new Error("useEmailCampaign must be used within EmailCampaignProvider");
  }
  return ctx;
}

export function useEmailCampaignOptional(): EmailCampaignContextValue | null {
  return React.useContext(EmailCampaignContext);
}

export { defaultCompose };
