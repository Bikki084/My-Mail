"use client";

import * as React from "react";
import type { RecipientRow } from "@/lib/merge-tags";
import { parsedCsvToRecipientRows } from "@/lib/csv-recipients";
import type { ParsedCsv } from "@/lib/csv-types";

const STORAGE_V = 1 as const;
const storageKey = (userId: string) => `mymail.campaign.csv.${STORAGE_V}.${userId}`;

export type ComposeDraft = {
  subject: string;
  text: string;
  html: string;
  senderName: string;
  streamName: string;
  encoding: string;
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

type EmailCampaignContextValue = {
  campaignRecipients: RecipientRow[];
  lastParsedCsv: ParsedCsv | null;
  setParsedCsvData: (data: ParsedCsv | null) => void;
  clearCampaignRecipients: () => void;
  composeDraft: ComposeDraft;
  setComposeDraft: React.Dispatch<React.SetStateAction<ComposeDraft>>;
  updateCompose: (partial: Partial<ComposeDraft>) => void;
};

const EmailCampaignContext = React.createContext<EmailCampaignContextValue | null>(null);

export function EmailCampaignProvider({
  children,
  /** When set, CSV is restored from and saved to `localStorage` for this key until cleared. */
  persistenceUserId = null,
}: {
  children: React.ReactNode;
  persistenceUserId?: string | null;
}) {
  const [lastParsedCsv, setLastParsedCsv] = React.useState<ParsedCsv | null>(null);
  const [composeDraft, setComposeDraft] = React.useState<ComposeDraft>({ ...defaultCompose });
  const [storageReady, setStorageReady] = React.useState(!persistenceUserId);

  const setParsedCsvData = React.useCallback((data: ParsedCsv | null) => {
    setLastParsedCsv(data);
  }, []);

  const clearCampaignRecipients = React.useCallback(() => {
    setLastParsedCsv(null);
    if (persistenceUserId) {
      try {
        localStorage.removeItem(storageKey(persistenceUserId));
      } catch {
        // ignore
      }
    }
  }, [persistenceUserId]);

  const updateCompose = React.useCallback((partial: Partial<ComposeDraft>) => {
    setComposeDraft((d) => ({ ...d, ...partial }));
  }, []);

  // Hydrate persisted CSV from localStorage (an external system). Sync-with-
  // external-system effects are the canonical use of useEffect, so the
  // setState-in-effect rule is suppressed here on purpose.
  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    if (!persistenceUserId) {
      setStorageReady(true);
      return;
    }
    try {
      const raw = localStorage.getItem(storageKey(persistenceUserId));
      if (!raw) {
        setStorageReady(true);
        return;
      }
      const p = JSON.parse(raw) as { v?: number; parsed?: ParsedCsv };
      if (p.v === STORAGE_V && p.parsed?.columnOrder && Array.isArray(p.parsed.rows)) {
        setLastParsedCsv(p.parsed);
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
    if (!lastParsedCsv) {
      try {
        localStorage.removeItem(storageKey(persistenceUserId));
      } catch {
        // ignore
      }
      return;
    }
    try {
      localStorage.setItem(
        storageKey(persistenceUserId),
        JSON.stringify({ v: STORAGE_V, parsed: lastParsedCsv, savedAt: Date.now() }),
      );
    } catch {
      // quota / private mode
    }
  }, [lastParsedCsv, persistenceUserId, storageReady]);

  const campaignRecipients = React.useMemo(
    () => parsedCsvToRecipientRows(lastParsedCsv),
    [lastParsedCsv],
  );

  const value = React.useMemo(
    () =>
      ({
        campaignRecipients,
        lastParsedCsv,
        setParsedCsvData,
        clearCampaignRecipients,
        composeDraft,
        setComposeDraft,
        updateCompose,
      }) satisfies EmailCampaignContextValue,
    [campaignRecipients, lastParsedCsv, setParsedCsvData, clearCampaignRecipients, composeDraft, updateCompose],
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
