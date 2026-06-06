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

export default function PaymentNotesLoading() {
  return (
    <>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <AdminPageHeader
          title="Payment Notes"
          description="Log cash/UPI payments when assigning or topping up credits."
        />
        <Skeleton className="h-10 w-28 shrink-0 bg-gray-700" />
      </div>
      <Skeleton className="h-10 max-w-md bg-gray-700" />
      <div className="overflow-hidden rounded-lg border border-emerald-900/35 bg-zinc-900/75 backdrop-blur-sm">
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-800 hover:bg-transparent">
              <TableHead className="text-zinc-400">User</TableHead>
              <TableHead className="text-zinc-400">Amount</TableHead>
              <TableHead className="text-zinc-400">Mode</TableHead>
              <TableHead className="text-zinc-400">Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[1, 2, 3].map((i) => (
              <TableRow key={i} className="border-zinc-800">
                <TableCell>
                  <Skeleton className="h-5 w-48 bg-gray-700" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-20 bg-gray-700" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-16 bg-gray-700" />
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
