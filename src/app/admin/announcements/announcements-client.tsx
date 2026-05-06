"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createAnnouncement, deleteAnnouncement, type AdminAnnouncementRow } from "./actions";

type Props = {
  rows: AdminAnnouncementRow[];
  fetchError?: string;
};

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

export function AnnouncementsClient({ rows, fetchError }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, startDeleteTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const titleTrim = title.trim();
  const bodyTrim = body.trim();
  const canSubmit = titleTrim.length > 0 && bodyTrim.length > 0 && !submitting;

  async function onPublish() {
    if (!canSubmit) {
      if (!titleTrim) toast.error("Title is required.");
      else if (!bodyTrim) toast.error("Message is required.");
      return;
    }
    setSubmitting(true);
    const res = await createAnnouncement({ title: titleTrim, body: bodyTrim });
    setSubmitting(false);
    if (!res.ok) {
      toast.error("Could not publish announcement.", { description: res.error });
      return;
    }
    toast.success("Announcement published.", {
      description: "Clients will see it on their next sign-in.",
    });
    setTitle("");
    setBody("");
    router.refresh();
  }

  function onDelete(id: string) {
    if (typeof window !== "undefined") {
      if (!window.confirm("Delete this announcement? Clients will no longer see it.")) return;
    }
    setPendingId(id);
    startDeleteTransition(async () => {
      const res = await deleteAnnouncement(id);
      setPendingId(null);
      if (!res.ok) {
        toast.error("Could not delete announcement.", { description: res.error });
        return;
      }
      toast.success("Announcement deleted.");
      router.refresh();
    });
  }

  return (
    <>
      <AdminPageHeader
        title="Announcements"
        description="Broadcast notices to all clients from the admin console."
      />

      {fetchError && (
        <p className="rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          Could not load announcements: {fetchError}
        </p>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-4 rounded-lg border border-gray-800 bg-[#111827] p-6">
          <h2 className="text-lg font-semibold text-white">New announcement</h2>
          <div className="space-y-2">
            <Label className="text-gray-300" htmlFor="announcement-title">
              Title <span className="text-red-400">*</span>
            </Label>
            <Input
              id="announcement-title"
              className="border-gray-700 bg-[#0F172A] text-white"
              placeholder="Short headline"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={160}
              disabled={submitting}
              required
              aria-required
            />
          </div>
          <div className="space-y-2">
            <Label className="text-gray-300" htmlFor="announcement-body">
              Message <span className="text-red-400">*</span>
            </Label>
            <Textarea
              id="announcement-body"
              className="min-h-[120px] border-gray-700 bg-[#0F172A] text-white"
              placeholder="Body text shown to clients…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={4000}
              disabled={submitting}
              required
              aria-required
            />
            <p className="text-xs text-gray-500">
              Both fields are required. Clients will see a pop-up on their next sign-in.
            </p>
          </div>
          <Button
            className="bg-indigo-600 hover:bg-indigo-500"
            onClick={onPublish}
            disabled={!canSubmit}
          >
            {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
            Publish
          </Button>
        </div>

        <div className="rounded-lg border border-gray-800 bg-[#111827] p-6">
          <h2 className="text-lg font-semibold text-white">Recent</h2>
          <p className="mb-4 text-sm text-gray-500">Latest announcements (newest first).</p>
          {rows.length === 0 ? (
            <div className="rounded-md border border-dashed border-gray-800 px-4 py-8 text-center">
              <p className="text-sm text-gray-400">No announcements yet.</p>
              <p className="mt-1 text-xs text-gray-500">
                Published announcements appear here and are shown to clients on sign-in.
              </p>
            </div>
          ) : (
            <ul className="space-y-0">
              {rows.map((a, i) => {
                const isDeleting = pendingId === a.id && deletingId;
                return (
                  <li
                    key={a.id}
                    className={`group relative ${i > 0 ? "border-t border-gray-800 pt-4 mt-4" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-white">{a.title}</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-400">
                          {a.body}
                        </p>
                        <p className="mt-2 text-xs text-gray-500">{formatDate(a.created_at)}</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 border-gray-700 text-gray-400 hover:border-red-900 hover:bg-red-950/30 hover:text-red-300"
                        onClick={() => onDelete(a.id)}
                        disabled={Boolean(isDeleting)}
                        aria-label={`Delete "${a.title}"`}
                      >
                        {isDeleting ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
