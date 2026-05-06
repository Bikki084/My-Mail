"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
import type { PaymentNoteListItem } from "./actions";

type PaymentNotesClientProps = {
  rows: PaymentNoteListItem[];
  fetchError?: string;
};

export function PaymentNotesClient({ rows, fetchError }: PaymentNotesClientProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.userLabel.toLowerCase().includes(q));
  }, [rows, search]);

  return (
    <>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <AdminPageHeader
          title="Payment Notes"
          description="Log cash/UPI payments when assigning or topping up credits."
        />
        <Button
          className="shrink-0 bg-indigo-600 hover:bg-indigo-500"
          onClick={() => {
            setOpen(true);
            console.log("Action triggered");
          }}
        >
          Add note
        </Button>
      </div>

      {fetchError && (
        <p className="rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          Could not load payment notes: {fetchError}
        </p>
      )}

      {rows.length > 0 && (
        <div className="relative max-w-md">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-500"
            aria-hidden
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by user name or email…"
            className="border-gray-700 bg-[#111827] pl-9 text-white placeholder:text-gray-500"
            aria-label="Filter payment notes by user"
          />
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-800 bg-[#111827]">
        <Table>
          <TableHeader>
            <TableRow className="border-gray-800 hover:bg-transparent">
              <TableHead className="text-gray-400">User</TableHead>
              <TableHead className="text-gray-400">Amount</TableHead>
              <TableHead className="text-gray-400">Mode</TableHead>
              <TableHead className="text-gray-400">Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fetchError && (
              <TableRow className="border-gray-800">
                <TableCell colSpan={4} className="text-center text-gray-500">
                  Unable to display payment notes. See the message above.
                </TableCell>
              </TableRow>
            )}
            {!fetchError && rows.length === 0 && (
              <TableRow className="border-gray-800">
                <TableCell colSpan={4} className="text-center text-gray-500">
                  No payment notes available
                </TableCell>
              </TableRow>
            )}
            {filtered.length === 0 && rows.length > 0 && search.trim() !== "" && (
              <TableRow className="border-gray-800">
                <TableCell colSpan={4} className="text-center text-gray-500">
                  No rows match your search.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((row) => (
              <TableRow key={row.id} className="border-gray-800">
                <TableCell className="font-medium text-white">{row.userLabel}</TableCell>
                <TableCell className="text-gray-300">{row.amountDisplay}</TableCell>
                <TableCell className="text-gray-400">{row.modeDisplay}</TableCell>
                <TableCell className="text-gray-500">{row.dateDisplay}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-gray-800 bg-[#111827] text-gray-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Add payment note</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-gray-300">Amount</Label>
              <Input className="border-gray-700 bg-[#0F172A] text-white" placeholder="₹0" />
            </div>
            <div className="space-y-2">
              <Label className="text-gray-300">Mode</Label>
              <Input className="border-gray-700 bg-[#0F172A] text-white" placeholder="UPI / Cash" />
            </div>
            <div className="space-y-2">
              <Label className="text-gray-300">Date</Label>
              <Input type="date" className="border-gray-700 bg-[#0F172A] text-white" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-gray-700" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-indigo-600 hover:bg-indigo-500"
              onClick={() => {
                console.log("Action triggered");
                setOpen(false);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
