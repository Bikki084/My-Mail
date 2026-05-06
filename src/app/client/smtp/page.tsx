import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isClientDashboardPreviewMode } from "@/lib/auth-config";
import { createClient } from "@/lib/supabase/server";

export default async function ClientSmtpPage() {
  type Row = Record<string, unknown> & {
    id: string;
    label: string | null;
    provider: string | null;
    host: string;
    port: number;
    secure: boolean;
  };
  let rows: Row[] = [];

  if (!isClientDashboardPreviewMode()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data } = await supabase
      .from("smtp_servers")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    rows = (data ?? []) as Row[];
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">SMTP servers</h1>
        <p className="text-muted-foreground">
          Presets: Gmail, Yahoo, Outlook, or custom host/port/TLS. Multiple accounts rotate per
          campaign (round robin, random, threshold) — configured on the campaign record and
          processed by the worker.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Your SMTP endpoints</CardTitle>
          <CardDescription>
            Stored per client; passwords are persisted encrypted in production (use Supabase Vault or
            app-level encryption).
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Host</TableHead>
                <TableHead>Port</TableHead>
                <TableHead>TLS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.label ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{r.provider ?? "custom"}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{r.host}</TableCell>
                  <TableCell>{r.port}</TableCell>
                  <TableCell>{r.secure ? "yes" : "no"}</TableCell>
                </TableRow>
              ))}
              {!rows?.length && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No SMTP servers yet. Insert via API or Supabase with your credentials.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
