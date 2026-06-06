import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function LoginHistoryLoading() {
  return (
    <>
      <AdminPageHeader
        title="Login History"
        description="Audit trail of client login and logout events."
      />
      <div className="rounded-lg border border-emerald-900/35 bg-zinc-900/75 backdrop-blur-sm p-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Skeleton className="h-16 bg-gray-700 sm:col-span-2" />
          <Skeleton className="h-16 bg-gray-700" />
          <Skeleton className="h-16 bg-gray-700" />
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-emerald-900/35 bg-zinc-900/75 backdrop-blur-sm">
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-800 hover:bg-transparent">
              <TableHead className="text-zinc-400">User</TableHead>
              <TableHead className="text-zinc-400">Login time</TableHead>
              <TableHead className="text-zinc-400">Logout time</TableHead>
              <TableHead className="text-zinc-400">IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[1, 2, 3, 4].map((i) => (
              <TableRow key={i} className="border-zinc-800">
                <TableCell>
                  <Skeleton className="h-5 w-48 bg-gray-700" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-32 bg-gray-700" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-32 bg-gray-700" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-28 bg-gray-700" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
