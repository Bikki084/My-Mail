"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { ChevronDown, ChevronRight, Eye, Info, Loader2, Search } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getUserActivitySampleMail,
  listUserActivityBatches,
  listUserActivityRecipients,
  searchUsersForActivity,
  type UserActivityBatchRow,
  type UserActivityMailPreview,
  type UserActivityRecipientRow,
  type UserActivitySearchUser,
} from "./actions";

type Props = {
  users: UserActivitySearchUser[];
  batches: UserActivityBatchRow[];
  selectedUserId: string;
  selectedDate: string;
  fetchError?: string;
};

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "sent":
      return "border-emerald-800 text-emerald-400";
    case "failed":
    case "bounced":
      return "border-red-800 text-red-400";
    default:
      return "border-gray-600 text-zinc-400";
  }
}

function shortBatchId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

export function UserActivityClient({
  users: initialUsers,
  batches: initialBatches,
  selectedUserId,
  selectedDate,
  fetchError,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const [userQuery, setUserQuery] = React.useState(() => {
    if (!selectedUserId) return "";
    const u = initialUsers.find((x) => x.id === selectedUserId);
    return u?.label ?? "";
  });
  const [userResults, setUserResults] = React.useState<UserActivitySearchUser[]>(initialUsers);
  const [showUserDropdown, setShowUserDropdown] = React.useState(false);
  const [selectedUser, setSelectedUser] = React.useState<UserActivitySearchUser | null>(() => {
    if (!selectedUserId) return null;
    return initialUsers.find((u) => u.id === selectedUserId) ?? null;
  });
  const [dateYmd, setDateYmd] = React.useState(selectedDate || todayYmd());
  const [batches, setBatches] = React.useState(initialBatches);
  const [loadingBatches, setLoadingBatches] = React.useState(false);
  const [expandedBatchId, setExpandedBatchId] = React.useState<string | null>(null);
  const [recipientsByBatch, setRecipientsByBatch] = React.useState<
    Record<string, UserActivityRecipientRow[]>
  >({});
  const [loadingRecipients, setLoadingRecipients] = React.useState<string | null>(null);
  const [mailOpen, setMailOpen] = React.useState(false);
  const [mailLoading, setMailLoading] = React.useState(false);
  const [mailPreview, setMailPreview] = React.useState<UserActivityMailPreview | null>(null);
  const [mailError, setMailError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setBatches(initialBatches);
    if (selectedUserId) {
      const u = initialUsers.find((x) => x.id === selectedUserId);
      if (u) {
        setSelectedUser(u);
        setUserQuery(u.label);
      }
    }
    setDateYmd(selectedDate || todayYmd());
  }, [initialBatches, initialUsers, selectedUserId, selectedDate]);

  React.useEffect(() => {
    const t = window.setTimeout(async () => {
      const res = await searchUsersForActivity(userQuery);
      if (res.ok) setUserResults(res.data ?? []);
    }, 200);
    return () => window.clearTimeout(t);
  }, [userQuery]);

  function pushFilters(userId: string, date: string) {
    const sp = new URLSearchParams();
    if (userId) sp.set("userId", userId);
    if (date) sp.set("date", date);
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  async function applyUserAndDate(user: UserActivitySearchUser | null, date: string) {
    if (!user) {
      setActionError("Select a user to view activity.");
      return;
    }
    setActionError(null);
    setLoadingBatches(true);
    setExpandedBatchId(null);
    setRecipientsByBatch({});
    pushFilters(user.id, date);
    const res = await listUserActivityBatches({ userId: user.id, dateYmd: date });
    setLoadingBatches(false);
    if (!res.ok) {
      setActionError(res.error);
      setBatches([]);
      return;
    }
    setBatches(res.data ?? []);
  }

  function selectUser(u: UserActivitySearchUser) {
    setSelectedUser(u);
    setUserQuery(u.label);
    setShowUserDropdown(false);
    void applyUserAndDate(u, dateYmd);
  }

  async function toggleBatchDetails(campaignId: string) {
    if (expandedBatchId === campaignId) {
      setExpandedBatchId(null);
      return;
    }
    setExpandedBatchId(campaignId);
    if (recipientsByBatch[campaignId]) return;

    setLoadingRecipients(campaignId);
    const res = await listUserActivityRecipients(campaignId);
    setLoadingRecipients(null);
    if (!res.ok) {
      setActionError(res.error);
      return;
    }
    setRecipientsByBatch((prev) => ({ ...prev, [campaignId]: res.data ?? [] }));
  }

  async function showSampleMail(campaignId: string) {
    setMailOpen(true);
    setMailLoading(true);
    setMailPreview(null);
    setMailError(null);
    const res = await getUserActivitySampleMail(campaignId);
    setMailLoading(false);
    if (!res.ok) {
      setMailError(res.error);
      return;
    }
    setMailPreview(res.data ?? null);
  }

  const displayError = actionError ?? fetchError;

  return (
    <div>
      <AdminPageHeader
        title="User Activity"
        description="Monitor email sending activity per user — batches, recipients, and sample mail previews."
      />

      <div className="mb-6 flex gap-3 rounded-lg border border-blue-900/50 bg-blue-950/30 px-4 py-3 text-sm text-blue-200">
        <Info className="mt-0.5 size-4 shrink-0 text-blue-400" />
        <p>
          <strong className="font-medium text-blue-100">Note:</strong> User activity data (batches,
          recipients, and mail contents) is automatically deleted from the database{" "}
          <strong className="font-medium text-blue-100">2 days</strong> after the date it was sent.
        </p>
      </div>

      {displayError ? (
        <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {displayError}
        </div>
      ) : null}

      <div className="mb-8 grid gap-4 rounded-xl border border-gray-800 bg-[#111827] p-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Label htmlFor="user-search" className="mb-2 block text-gray-400">
            User (name or email)
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-500" />
            <Input
              id="user-search"
              value={userQuery}
              onChange={(e) => {
                setUserQuery(e.target.value);
                setShowUserDropdown(true);
                if (!e.target.value.trim()) setSelectedUser(null);
              }}
              onFocus={() => setShowUserDropdown(true)}
              placeholder="Search by name or email…"
              className="border-gray-700 bg-[#0F172A] pl-9 text-gray-100 placeholder:text-gray-500"
              autoComplete="off"
            />
          </div>
          {showUserDropdown && userResults.length > 0 ? (
            <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-gray-700 bg-[#1e293b] py-1 shadow-lg">
              {userResults.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-white/10"
                    onClick={() => selectUser(u)}
                  >
                    {u.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div>
          <Label htmlFor="activity-date" className="mb-2 block text-gray-400">
            Date
          </Label>
          <Input
            id="activity-date"
            type="date"
            value={dateYmd}
            onChange={(e) => setDateYmd(e.target.value)}
            className="border-gray-700 bg-[#0F172A] text-gray-100"
          />
        </div>

        <div className="flex items-end">
          <Button
            type="button"
            className="w-full bg-indigo-600 hover:bg-indigo-500"
            disabled={!selectedUser || loadingBatches}
            onClick={() => void applyUserAndDate(selectedUser, dateYmd)}
          >
            {loadingBatches ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Loading…
              </>
            ) : (
              "Load activity"
            )}
          </Button>
        </div>
      </div>

      {selectedUser ? (
        <p className="mb-4 text-sm text-gray-400">
          Showing batches for{" "}
          <span className="font-medium text-gray-200">{selectedUser.label}</span> on{" "}
          <span className="font-medium text-gray-200">{dateYmd}</span>
          {loadingBatches ? " …" : ` (${batches.length} batch${batches.length === 1 ? "" : "es"})`}
        </p>
      ) : (
        <p className="mb-4 text-sm text-gray-500">Select a user and date to view sending batches.</p>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-800 bg-[#111827]">
        <Table>
          <TableHeader>
            <TableRow className="border-gray-800 hover:bg-transparent">
              <TableHead className="w-10 text-gray-400" />
              <TableHead className="text-gray-400">Batch ID / Timestamp</TableHead>
              <TableHead className="text-gray-400">Subject / Stream</TableHead>
              <TableHead className="text-gray-400">Recipients</TableHead>
              <TableHead className="text-gray-400">Sent / Failed</TableHead>
              <TableHead className="text-right text-gray-400">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.length === 0 ? (
              <TableRow className="border-gray-800">
                <TableCell colSpan={6} className="py-10 text-center text-gray-500">
                  {selectedUser && !loadingBatches
                    ? "No batches found for this user on the selected date."
                    : "No data yet."}
                </TableCell>
              </TableRow>
            ) : (
              batches.map((batch) => {
                const expanded = expandedBatchId === batch.campaignId;
                const recipients = recipientsByBatch[batch.campaignId];
                return (
                  <React.Fragment key={batch.campaignId}>
                    <TableRow className="border-gray-800 hover:bg-white/[0.02]">
                      <TableCell>
                        <button
                          type="button"
                          className="text-gray-400 hover:text-white"
                          aria-label={expanded ? "Collapse batch" : "Expand batch"}
                          onClick={() => void toggleBatchDetails(batch.campaignId)}
                        >
                          {expanded ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-gray-300">
                        <div title={batch.campaignId}>{shortBatchId(batch.campaignId)}</div>
                        <div className="mt-0.5 font-sans text-sm text-gray-400">
                          {formatDateTime(batch.sentAt)}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate text-gray-200">
                        {batch.subject || batch.streamName || "—"}
                      </TableCell>
                      <TableCell className="text-gray-300">{batch.recipientCount}</TableCell>
                      <TableCell className="text-gray-300">
                        <span className="text-emerald-400">{batch.sentCount}</span>
                        {" / "}
                        <span className="text-red-400">{batch.failedCount}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="border-gray-700 bg-[#0F172A] text-gray-200 hover:bg-gray-800"
                          onClick={() => void toggleBatchDetails(batch.campaignId)}
                        >
                          View Batch Details
                        </Button>
                      </TableCell>
                    </TableRow>
                    {expanded ? (
                      <TableRow className="border-gray-800 bg-[#0B0F19]/80 hover:bg-[#0B0F19]/80">
                        <TableCell colSpan={6} className="p-0">
                          <div className="border-t border-gray-800 px-4 py-4">
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                              <h3 className="text-sm font-medium text-gray-200">
                                Recipients ({recipients?.length ?? "…"})
                              </h3>
                              <Button
                                type="button"
                                size="sm"
                                className="bg-indigo-600 hover:bg-indigo-500"
                                onClick={() => void showSampleMail(batch.campaignId)}
                              >
                                <Eye className="mr-2 size-4" />
                                Show Sample Mail
                              </Button>
                            </div>
                            {loadingRecipients === batch.campaignId ? (
                              <div className="flex items-center gap-2 py-6 text-sm text-gray-400">
                                <Loader2 className="size-4 animate-spin" />
                                Loading recipients…
                              </div>
                            ) : recipients && recipients.length > 0 ? (
                              <div className="max-h-64 overflow-auto rounded-lg border border-gray-800">
                                <Table>
                                  <TableHeader>
                                    <TableRow className="border-gray-800 hover:bg-transparent">
                                      <TableHead className="text-gray-500">Email</TableHead>
                                      <TableHead className="text-gray-500">Status</TableHead>
                                      <TableHead className="text-gray-500">Sent at</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {recipients.map((r) => (
                                      <TableRow
                                        key={r.id}
                                        className="border-gray-800 hover:bg-white/[0.02]"
                                      >
                                        <TableCell className="font-mono text-xs text-gray-300">
                                          {r.recipientEmail}
                                        </TableCell>
                                        <TableCell>
                                          <Badge
                                            variant="outline"
                                            className={statusBadgeClass(r.status)}
                                          >
                                            {r.status}
                                          </Badge>
                                        </TableCell>
                                        <TableCell className="text-sm text-gray-400">
                                          {formatDateTime(r.sentAt)}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            ) : (
                              <p className="py-4 text-sm text-gray-500">No recipients recorded.</p>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </React.Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={mailOpen} onOpenChange={setMailOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-gray-800 bg-[#111827] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-white">Sample Mail Preview</DialogTitle>
            <DialogDescription className="text-gray-400">
              One representative email from this batch (merge tags applied for the sample recipient).
            </DialogDescription>
          </DialogHeader>

          {mailLoading ? (
            <div className="flex items-center gap-2 py-8 text-gray-400">
              <Loader2 className="size-5 animate-spin" />
              Loading mail…
            </div>
          ) : mailError ? (
            <p className="text-sm text-red-400">{mailError}</p>
          ) : mailPreview ? (
            <div className="space-y-4 text-sm">
              <div className="grid gap-2 rounded-lg border border-gray-800 bg-[#0F172A] p-3">
                <div>
                  <span className="text-gray-500">Recipient: </span>
                  <span className="font-mono text-gray-200">{mailPreview.recipientEmail}</span>
                </div>
                {mailPreview.senderName ? (
                  <div>
                    <span className="text-gray-500">From name: </span>
                    <span className="text-gray-200">{mailPreview.senderName}</span>
                  </div>
                ) : null}
                <div>
                  <span className="text-gray-500">Subject: </span>
                  <span className="text-gray-200">{mailPreview.subject || "—"}</span>
                </div>
              </div>

              {mailPreview.attachments.length > 0 ? (
                <div>
                  <p className="mb-2 font-medium text-gray-300">Attachments</p>
                  <ul className="space-y-2">
                    {mailPreview.attachments.map((a) => (
                      <li
                        key={a.filename}
                        className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-800 bg-[#0F172A] px-3 py-2"
                      >
                        <span className="text-gray-200">{a.filename}</span>
                        <span className="text-gray-500">{formatBytes(a.sizeBytes)}</span>
                        <a
                          href={a.downloadDataUrl}
                          download={a.filename}
                          className="text-indigo-400 hover:text-indigo-300"
                        >
                          Download
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div>
                <p className="mb-2 font-medium text-gray-300">Body</p>
                {mailPreview.bodyHtml ? (
                  <div
                    className="prose prose-invert max-w-none rounded-lg border border-gray-800 bg-white p-4 text-gray-900 prose-p:my-2"
                    dangerouslySetInnerHTML={{ __html: mailPreview.bodyHtml }}
                  />
                ) : (
                  <pre className="whitespace-pre-wrap rounded-lg border border-gray-800 bg-[#0F172A] p-4 text-gray-300">
                    {mailPreview.bodyText || "—"}
                  </pre>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
