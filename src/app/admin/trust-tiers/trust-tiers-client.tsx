"use client";

import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AdminTrustTierRow } from "./actions";

function tierBadgeClass(tier: AdminTrustTierRow["tier"]): string {
  switch (tier) {
    case "established":
      return "border-emerald-800 bg-emerald-950/50 text-emerald-200";
    case "warming":
      return "border-amber-800 bg-amber-950/50 text-amber-200";
    case "restricted":
      return "border-red-800 bg-red-950/50 text-red-200";
    default:
      return "border-zinc-700 bg-zinc-900 text-zinc-300";
  }
}

export function TrustTiersClient({ rows }: { rows: AdminTrustTierRow[] }) {
  return (
    <>
      <AdminPageHeader
        title="Trust tiers"
        description="Per-client sending limits based on account age and deliverability metrics. Limits are enforced at send-time before messages reach the ESP."
      />
      <div className="overflow-x-auto rounded-lg border border-gray-800 bg-[#111827]">
        <Table>
          <TableHeader>
            <TableRow className="border-gray-800 hover:bg-transparent">
              <TableHead className="text-gray-400">Client</TableHead>
              <TableHead className="text-gray-400">Tier</TableHead>
              <TableHead className="text-right text-gray-400">Daily limit</TableHead>
              <TableHead className="text-right text-gray-400">Sent today</TableHead>
              <TableHead className="text-right text-gray-400">Remaining</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="border-gray-800">
                <TableCell colSpan={5} className="text-center text-gray-500">
                  No client accounts found.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.userId} className="border-gray-800">
                  <TableCell>
                    <div>
                      <p className="font-medium text-gray-100">{r.email}</p>
                      {r.fullName ? (
                        <p className="text-xs text-gray-500">{r.fullName}</p>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={tierBadgeClass(r.tier)}>
                      {r.tier}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-gray-200">
                    {r.dailyLimit.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-gray-200">
                    {r.sentToday.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-gray-200">
                    {r.remainingToday.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
