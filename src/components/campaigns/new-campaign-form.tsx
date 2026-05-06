"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import type { RecipientRow } from "@/lib/merge-tags";
import {
  MAIL_ENCODING_LABELS,
  MAIL_ENCODING_UI,
  type MailEncodingUi,
} from "@/lib/mail-encoding";

export function NewCampaignForm() {
  const router = useRouter();
  const [streamName, setStreamName] = useState("");
  const [subject, setSubject] = useState("");
  const [senderName, setSenderName] = useState("");
  const [bodyHtml, setBodyHtml] = useState("<p>Hello {{name}},</p>");
  const [encoding, setEncoding] = useState<MailEncodingUi>("auto");
  const [recipients, setRecipients] = useState<RecipientRow[]>([]);
  const [loading, setLoading] = useState(false);

  function onFile(f: File | null) {
    if (!f) return;
    Papa.parse<Record<string, string>>(f, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const rows: RecipientRow[] = [];
        const dup = new Set<string>();
        for (const row of res.data) {
          const email = (row.email ?? row.Email ?? "").trim().toLowerCase();
          if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
          if (dup.has(email)) continue;
          dup.add(email);
          rows.push({
            email,
            name: row.name ?? row.Name ?? "",
            c3: row.c3 ?? row.C3 ?? "",
            c4: row.c4 ?? row.C4 ?? "",
            c5: row.c5 ?? row.C5 ?? "",
            c6: row.c6 ?? row.C6 ?? "",
          });
        }
        setRecipients(rows);
        toast.success(`Parsed ${rows.length} unique valid recipients`);
      },
      error: (err) => toast.error(err.message),
    });
  }

  async function saveDraft() {
    setLoading(true);
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stream_name: streamName,
        subject,
        sender_name: senderName,
        body_html: bodyHtml,
        encoding,
        recipients,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      toast.error(typeof json.error === "string" ? json.error : "Save failed");
      return;
    }
    toast.success("Campaign saved as draft");
    router.push("/client/campaigns");
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Campaign</CardTitle>
          <CardDescription>
            Subject and sender support merge tags:{" "}
            <code className="text-xs">{"{{{email}}}"}</code>,{" "}
            <code className="text-xs">{"{{{name}}}"}</code>,{" "}
            <code className="text-xs">{"{{{c3}}}–{{{c6}}}"}</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="stream">Campaign name</Label>
            <Input
              id="stream"
              value={streamName}
              onChange={(e) => setStreamName(e.target.value)}
              placeholder="Q2 newsletter"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sender">Sender name</Label>
            <Input
              id="sender"
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              placeholder="Acme Inc."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Hi {{{name}}}, your update"
            />
          </div>
          <div className="space-y-2">
            <Label>Encoding</Label>
            <Select
              value={encoding}
              onValueChange={(v) => setEncoding(v as MailEncodingUi)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MAIL_ENCODING_UI.map((key) => (
                  <SelectItem key={key} value={key}>
                    {MAIL_ENCODING_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Auto is recommended for most campaigns. Use the Email Composer to attach a PDF or PNG
              generated from custom HTML.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="html">Email Content (HTML)</Label>
            <Textarea
              id="html"
              rows={10}
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              This is the main email content. A plain-text version will be automatically
              generated for compatibility.
            </p>
          </div>
        </CardContent>
      </Card>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Recipients (CSV)</CardTitle>
            <CardDescription>
              Columns: <code className="text-xs">email</code>,{" "}
              <code className="text-xs">name</code>,{" "}
              <code className="text-xs">c3</code>–<code className="text-xs">c6</code>. Parsed
              with PapaParse on the client.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            />
            <div className="max-h-64 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>email</TableHead>
                    <TableHead>name</TableHead>
                    <TableHead>c3</TableHead>
                    <TableHead>c4</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recipients.slice(0, 20).map((r) => (
                    <TableRow key={r.email}>
                      <TableCell className="font-mono text-xs">{r.email}</TableCell>
                      <TableCell className="text-xs">{r.name}</TableCell>
                      <TableCell className="text-xs">{r.c3}</TableCell>
                      <TableCell className="text-xs">{r.c4}</TableCell>
                    </TableRow>
                  ))}
                  {!recipients.length && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        Upload a CSV to preview the first 20 rows
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {recipients.length > 20 && (
              <p className="text-xs text-muted-foreground">
                Showing 20 of {recipients.length} rows
              </p>
            )}
          </CardContent>
        </Card>
        <Button
          className="w-full"
          disabled={loading || !streamName.trim() || !recipients.length}
          onClick={() => void saveDraft()}
        >
          {loading ? "Saving…" : "Save draft"}
        </Button>
      </div>
    </div>
  );
}
