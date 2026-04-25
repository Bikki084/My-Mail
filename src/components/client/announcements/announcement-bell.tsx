"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  listAnnouncementsForClient,
  markAnnouncementsRead,
  type AnnouncementItem,
} from "@/app/actions/announcements";

/** localStorage key (prefix) storing acknowledged announcement IDs per user —
 *  survives reloads even when the `announcement_reads` migration hasn't been
 *  applied. Scoped by userId so sharing a browser between accounts is safe. */
const LOCAL_ACK_KEY_PREFIX = "mm:announcements-acked";
/** sessionStorage key tracking whether the auto-popup has been shown this
 *  session for a specific (user, latest-unread-id) combination. Scoped by
 *  userId so switching accounts reliably re-triggers the popup. */
const AUTO_POPUP_KEY = "mm:announcements-autoshown";

function localAckKey(userId: string | null | undefined): string {
  return userId ? `${LOCAL_ACK_KEY_PREFIX}:${userId}` : LOCAL_ACK_KEY_PREFIX;
}

function readLocalAcks(userId: string | null | undefined): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(localAckKey(userId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function writeLocalAcks(
  userId: string | null | undefined,
  ids: Iterable<string>,
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      localAckKey(userId),
      JSON.stringify([...new Set(ids)]),
    );
  } catch {
    // Ignore storage quota / private mode errors.
  }
}

function readAutoShown(userId: string | null | undefined): string | null {
  if (typeof window === "undefined") return null;
  if (!userId) return null;
  try {
    return sessionStorage.getItem(`${AUTO_POPUP_KEY}:${userId}`);
  } catch {
    return null;
  }
}

function writeAutoShown(
  userId: string | null | undefined,
  latestUnreadId: string,
): void {
  if (typeof window === "undefined") return;
  if (!userId) return;
  try {
    sessionStorage.setItem(`${AUTO_POPUP_KEY}:${userId}`, latestUnreadId);
  } catch {
    // Ignore.
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

type Props = {
  className?: string;
  /** SSR-fetched full list (newest first). */
  initialAll?: AnnouncementItem[];
  /** SSR-fetched unread list (server-side read tracking). */
  initialUnread?: AnnouncementItem[];
  /** Supabase user id — scopes per-user client-side state. */
  userId?: string | null;
};

export function AnnouncementBell({
  className,
  initialAll = [],
  initialUnread = [],
  userId = null,
}: Props) {
  const [all, setAll] = useState<AnnouncementItem[]>(initialAll);
  const [serverUnreadIds, setServerUnreadIds] = useState<Set<string>>(
    () => new Set(initialUnread.map((a) => a.id)),
  );
  const [localAckIds, setLocalAckIds] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState(false);

  /** The auto-popup (shown once per user per newest-unread announcement). */
  const [popupItem, setPopupItem] = useState<AnnouncementItem | null>(null);
  const didAutoPopupRef = useRef(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);

  // Hydrate local acknowledgements once on mount / when user changes.
  // This is a legitimate "sync with external system" effect (localStorage),
  // which the lint rule's "set-state-in-effect" guidance explicitly carves out.
  // Doing this during render would cause an SSR/hydration mismatch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalAckIds(readLocalAcks(userId));
  }, [userId]);

  // Refresh the list on mount so newly-published items appear without reload.
  // Also called by the poll/visibility effects below so deletions from the
  // admin console propagate to already-open client sessions without a reload.
  const refresh = useCallback(async () => {
    try {
      const res = await listAnnouncementsForClient();
      if (res.ok) {
        const nextAll = res.all;
        const nextIds = new Set(nextAll.map((a) => a.id));
        setAll(nextAll);
        setServerUnreadIds(new Set(res.unread.map((a) => a.id)));
        // If the currently shown auto-popup references an announcement that
        // was deleted upstream, dismiss it so the UI matches the server.
        setPopupItem((prev) => (prev && !nextIds.has(prev.id) ? null : prev));
      }
    } catch {
      // Non-fatal — we keep whatever we already had from SSR.
    }
  }, []);

  // Initial network refresh after mount. The setState inside `refresh` happens
  // after `await`, so it isn't synchronous within the effect — the lint rule
  // can't see through the async boundary, hence the disable.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  // Periodic poll + refresh when the tab regains focus/visibility, so a
  // deletion performed by an admin disappears from open client sessions
  // (bell list, red dot, and any lingering popup) within ~30s.
  useEffect(() => {
    const POLL_MS = 30_000;
    const interval = window.setInterval(() => {
      void refresh();
    }, POLL_MS);
    const onFocus = () => void refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  const unread = useMemo<AnnouncementItem[]>(() => {
    if (all.length === 0) return [];
    return all.filter(
      (a) => serverUnreadIds.has(a.id) && !localAckIds.has(a.id),
    );
  }, [all, serverUnreadIds, localAckIds]);

  const hasUnread = unread.length > 0;

  // Auto-popup on first load when the user has unread announcements and we
  // haven't already shown a popup this session for the latest unread item.
  // Keyed by userId so logging out and back in as a different user triggers it
  // again ("first time" for that user).
  // Auto-popup gating depends on sessionStorage (browser-only) so it must run
  // post-hydration in an effect rather than during render. The setState here
  // is gated by a ref + storage check so it fires at most once per session.
  useEffect(() => {
    if (didAutoPopupRef.current) return;
    if (!userId) return;
    // Use the server unread list, not the UI-filtered unread — localStorage
    // acks are only a fallback for the current browser/user and should not
    // suppress the initial popup on a fresh login from another account.
    const latestServerUnread = all.find((a) => serverUnreadIds.has(a.id));
    if (!latestServerUnread) return;

    const alreadyShownFor = readAutoShown(userId);
    if (alreadyShownFor === latestServerUnread.id) return;

    didAutoPopupRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPopupItem(latestServerUnread);
  }, [all, serverUnreadIds, userId]);

  // Acknowledge: clears the red dot locally + best-effort server persistence.
  const acknowledge = useCallback(() => {
    if (unread.length === 0) return;
    const ids = unread.map((u) => u.id);
    setLocalAckIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      writeLocalAcks(userId, next);
      return next;
    });
    void markAnnouncementsRead(ids).catch(() => {
      // The local ack still clears the dot; server-side is a nice-to-have.
    });
  }, [unread, userId]);

  // Click outside / Escape: close the panel and mark as read.
  useEffect(() => {
    if (!open) return;
    function close() {
      acknowledge();
      setOpen(false);
    }
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (bellRef.current?.contains(target)) return;
      close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, acknowledge]);

  // Dismiss the auto-popup: close it and record that we showed it for this
  // (user, latest-unread-id). Do NOT mark-as-read — user wants the red dot to
  // persist on the bell so they can re-open the message from the panel.
  const dismissPopup = useCallback(() => {
    if (popupItem) writeAutoShown(userId, popupItem.id);
    setPopupItem(null);
  }, [popupItem, userId]);

  // Escape closes the popup as well.
  useEffect(() => {
    if (!popupItem) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") dismissPopup();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [popupItem, dismissPopup]);

  function toggle() {
    setOpen((prev) => !prev);
  }

  const panelItems = all.slice(0, 15);

  return (
    <div className="relative">
      <button
        ref={bellRef}
        type="button"
        onClick={toggle}
        aria-label={
          hasUnread
            ? `Announcements: ${unread.length} unread`
            : "Announcements"
        }
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "group relative flex size-9 items-center justify-center rounded-lg border border-transparent text-zinc-400 outline-none transition-colors hover:border-zinc-700/80 hover:bg-zinc-800/60 hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-zinc-600",
          open && "border-zinc-700/80 bg-zinc-800/60 text-zinc-200",
          className,
        )}
      >
        <Bell className="size-5" strokeWidth={1.75} />
        {hasUnread && (
          <span
            aria-hidden
            className="absolute right-2 top-2 size-2 rounded-full bg-red-500 ring-2 ring-zinc-950"
          />
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="menu"
          aria-label="Announcements"
          className="absolute right-0 top-full z-50 mt-2 w-[22rem] max-w-[90vw] origin-top-right overflow-hidden rounded-xl border border-zinc-800 bg-[#0F172A] text-zinc-100 shadow-xl shadow-black/40 ring-1 ring-white/5"
        >
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <p className="text-sm font-semibold text-white">Announcements</p>
            {hasUnread && (
              <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-300">
                {unread.length} new
              </span>
            )}
          </div>
          <div className="max-h-[22rem] overflow-y-auto">
            {panelItems.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-zinc-400">No announcements yet.</p>
              </div>
            ) : (
              <ul className="divide-y divide-zinc-800">
                {panelItems.map((a) => {
                  const isNew =
                    serverUnreadIds.has(a.id) && !localAckIds.has(a.id);
                  return (
                    <li
                      key={a.id}
                      className={cn(
                        "relative px-4 py-3 transition-colors",
                        isNew ? "bg-indigo-500/5" : "",
                      )}
                    >
                      {isNew && (
                        <span
                          aria-hidden
                          className="absolute left-1.5 top-4 size-1.5 rounded-full bg-indigo-400"
                        />
                      )}
                      <p className="pr-2 text-sm font-semibold text-white">
                        {a.title}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-zinc-300">
                        {a.body}
                      </p>
                      <p className="mt-1.5 text-[11px] text-zinc-500">
                        {formatDate(a.created_at)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {popupItem && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="announcement-popup-title"
          className="fixed inset-0 z-[100] flex items-center justify-center px-4"
        >
          <div
            aria-hidden
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={dismissPopup}
          />
          <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-zinc-800 bg-[#0F172A] text-zinc-100 shadow-2xl shadow-black/60 ring-1 ring-white/5">
            <div className="flex items-start gap-3 border-b border-zinc-800 px-5 py-4">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-indigo-300">
                <Bell className="size-4" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-300">
                  New announcement
                </p>
                <h2
                  id="announcement-popup-title"
                  className="mt-0.5 truncate text-base font-semibold text-white"
                >
                  {popupItem.title}
                </h2>
              </div>
            </div>
            <div className="max-h-[50vh] overflow-y-auto px-5 py-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
                {popupItem.body}
              </p>
              <p className="mt-3 text-[11px] text-zinc-500">
                {formatDate(popupItem.created_at)}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-zinc-800 bg-zinc-900/40 px-5 py-3">
              <button
                type="button"
                onClick={dismissPopup}
                className="inline-flex h-9 items-center justify-center rounded-lg bg-indigo-500 px-4 text-sm font-medium text-white transition-colors hover:bg-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                autoFocus
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
