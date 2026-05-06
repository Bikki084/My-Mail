import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { mockCampaigns } from "@/lib/mocks/admin-mock-data";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function SendingMonitorPage() {
  return (
    <>
      <AdminPageHeader
        title="Sending Monitor"
        description="Live and historical campaigns across all clients (Phase 1 mock data)."
      />
      <div className="overflow-hidden rounded-lg border border-gray-800 bg-[#111827]">
        <Table>
          <TableHeader>
            <TableRow className="border-gray-800 hover:bg-transparent">
              <TableHead className="text-gray-400">Campaign</TableHead>
              <TableHead className="text-gray-400">Client</TableHead>
              <TableHead className="text-gray-400">Status</TableHead>
              <TableHead className="text-right text-gray-400">Emails sent</TableHead>
              <TableHead className="text-gray-400">Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mockCampaigns.map((c) => (
              <TableRow key={c.id} className="border-gray-800">
                <TableCell className="font-medium text-white">{c.name}</TableCell>
                <TableCell className="text-gray-400">{c.client}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      c.status === "completed"
                        ? "border-emerald-800 text-emerald-400"
                        : c.status === "sending"
                          ? "border-blue-800 text-blue-400"
                          : "border-gray-600 text-gray-400"
                    }
                  >
                    {c.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums text-gray-300">
                  {c.emailsSent.toLocaleString()}
                </TableCell>
                <TableCell className="text-gray-500">{c.date}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
