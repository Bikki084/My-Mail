import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { UserEmailsTodayRow } from "@/app/admin/actions";

export function UserEmailsTodayCards({
  rows,
  live,
}: {
  rows: UserEmailsTodayRow[];
  live: boolean;
}) {
  if (!live) {
    return (
      <p className="text-sm text-gray-400">
        Per-user send counts are unavailable — Supabase is not configured.
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-400">No client accounts yet.</p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => (
        <Card key={row.userId} className="border-gray-800 bg-[#111827]">
          <CardHeader className="pb-2">
            <CardTitle className="truncate text-sm font-medium text-white">
              {row.displayName}
            </CardTitle>
            {row.displayName !== row.email && (
              <p className="truncate text-xs text-gray-500">{row.email}</p>
            )}
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums text-emerald-400">
              {row.emailsSent.toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-gray-500">emails sent today</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
