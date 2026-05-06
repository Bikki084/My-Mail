"use client";

import { createContext, useContext } from "react";
import type { AnnouncementItem } from "@/app/actions/announcements";

export type AnnouncementsSnapshot = {
  all: AnnouncementItem[];
  unread: AnnouncementItem[];
  /** Current user's id — used to scope the per-user auto-popup flag. */
  userId: string | null;
};

const AnnouncementsContext = createContext<AnnouncementsSnapshot>({
  all: [],
  unread: [],
  userId: null,
});

export function AnnouncementsProvider({
  value,
  children,
}: {
  value: AnnouncementsSnapshot;
  children: React.ReactNode;
}) {
  return (
    <AnnouncementsContext.Provider value={value}>
      {children}
    </AnnouncementsContext.Provider>
  );
}

export function useAnnouncementsSnapshot(): AnnouncementsSnapshot {
  return useContext(AnnouncementsContext);
}
