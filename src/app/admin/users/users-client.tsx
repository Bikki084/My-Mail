"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
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
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  createClientUser,
  updateClientUserEmail,
  type AdminClientUserRow,
} from "./actions";

const ORG_NAME_REGEX = /^[a-zA-Z0-9 ]+$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldErrors = {
  organizationName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
};

const initialForm = {
  organizationName: "",
  email: "",
  password: "",
  confirmPassword: "",
};

function validateOrganizationName(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return "Organization name is required";
  if (!ORG_NAME_REGEX.test(trimmed)) {
    return "Organization name should not contain special characters";
  }
  return undefined;
}

function validateEmail(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return "Please enter a valid email address";
  if (!EMAIL_REGEX.test(trimmed)) return "Please enter a valid email address";
  return undefined;
}

function validatePassword(value: string): string | undefined {
  if (!value) return "Password is required";
  if (value.length < 6) return "Password must be at least 6 characters";
  return undefined;
}

function validateConfirmPassword(
  password: string,
  confirm: string,
): string | undefined {
  if (confirm !== password) return "Passwords do not match";
  return undefined;
}

type EditForm = {
  email: string;
};

type EditState = {
  user: AdminClientUserRow;
  form: EditForm;
  error?: string;
};

export function UsersClient({ initialRows }: { initialRows: AdminClientUserRow[] }) {
  const [rows, setRows] = useState<AdminClientUserRow[]>(initialRows);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isPending, startTransition] = useTransition();

  const [edit, setEdit] = useState<EditState | null>(null);
  const [isEditPending, startEditTransition] = useTransition();

  // Re-sync local state when the server-provided rows change (e.g. after
  // a `revalidatePath`). Using "adjust state during render" instead of an
  // effect avoids cascading re-renders.
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [lastInitialRows, setLastInitialRows] = useState(initialRows);
  if (lastInitialRows !== initialRows) {
    setLastInitialRows(initialRows);
    setRows(initialRows);
  }

  function resetForm() {
    setForm(initialForm);
    setErrors({});
  }

  function validateAll(): boolean {
    const next: FieldErrors = {
      organizationName: validateOrganizationName(form.organizationName),
      email: validateEmail(form.email),
      password: validatePassword(form.password),
      confirmPassword: validateConfirmPassword(form.password, form.confirmPassword),
    };
    setErrors(next);
    return !Object.values(next).some(Boolean);
  }

  function validateField(name: keyof typeof initialForm): void {
    setErrors((prev) => {
      const next = { ...prev };
      switch (name) {
        case "organizationName":
          next.organizationName = validateOrganizationName(form.organizationName);
          break;
        case "email":
          next.email = validateEmail(form.email);
          break;
        case "password":
          next.password = validatePassword(form.password);
          if (prev.confirmPassword || form.confirmPassword) {
            next.confirmPassword = validateConfirmPassword(form.password, form.confirmPassword);
          }
          break;
        case "confirmPassword":
          next.confirmPassword = validateConfirmPassword(form.password, form.confirmPassword);
          break;
        default:
          break;
      }
      return next;
    });
  }

  function handleOpenChange(nextOpen: boolean) {
    if (isPending) return;
    setOpen(nextOpen);
    if (!nextOpen) resetForm();
  }

  function openEdit(user: AdminClientUserRow) {
    setEdit({ user, form: { email: user.email ?? "" } });
  }

  function handleEditOpenChange(nextOpen: boolean) {
    if (isEditPending) return;
    if (!nextOpen) setEdit(null);
  }

  function handleEditSubmit(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    const nextEmail = edit.form.email.trim().toLowerCase();
    const emailError = validateEmail(nextEmail);
    if (emailError) {
      setEdit((prev) => (prev ? { ...prev, error: emailError } : prev));
      return;
    }
    if (nextEmail === (edit.user.email ?? "").toLowerCase()) {
      setEdit((prev) =>
        prev ? { ...prev, error: "New email must be different from the current one." } : prev,
      );
      return;
    }

    startEditTransition(async () => {
      const result = await updateClientUserEmail({
        userId: edit.user.id,
        email: nextEmail,
      });
      if (!result.ok) {
        toast.error("Could not update email.", { description: result.error });
        setEdit((prev) => (prev ? { ...prev, error: result.error } : prev));
        return;
      }
      const updated = result.data!;
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      toast.success("Email updated.", {
        description: `${edit.user.email} → ${updated.email}`,
      });
      setEdit(null);
    });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validateAll()) return;

    startTransition(async () => {
      const result = await createClientUser({
        organizationName: form.organizationName.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
      });

      if (!result.ok) {
        toast.error("Could not create user.", { description: result.error });
        return;
      }

      const newRow: AdminClientUserRow = {
        id: result.data!.userId,
        email: form.email.trim().toLowerCase(),
        full_name: form.organizationName.trim(),
        status: "active",
        created_at: new Date().toISOString(),
      };
      setRows((prev) => [newRow, ...prev]);
      toast.success("Client user created.", {
        description: `${newRow.email} can now sign in at /login.`,
      });
      setOpen(false);
      resetForm();
    });
  }

  return (
    <>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <AdminPageHeader
          title="User Management"
          description="Create and manage client accounts (admin-provisioned only)."
        />
        <Button
          className="shrink-0 bg-indigo-600 hover:bg-indigo-500"
          onClick={() => {
            resetForm();
            setOpen(true);
          }}
        >
          Create User
        </Button>
      </div>
      <div className="overflow-hidden rounded-lg border border-emerald-900/35 bg-zinc-900/75 backdrop-blur-sm">
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-800 hover:bg-transparent">
              <TableHead className="text-zinc-400">Name</TableHead>
              <TableHead className="text-zinc-400">Email</TableHead>
              <TableHead className="text-zinc-400">Status</TableHead>
              <TableHead className="text-zinc-400">Created</TableHead>
              <TableHead className="w-[120px] text-right text-zinc-400">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow className="border-zinc-800">
                <TableCell colSpan={5} className="text-center text-gray-500">
                  No client users yet. Click <span className="text-zinc-300">Create User</span> to add one.
                </TableCell>
              </TableRow>
            )}
            {rows.map((u) => (
              <TableRow key={u.id} className="border-zinc-800">
                <TableCell className="font-medium text-zinc-50">
                  {u.full_name?.trim() || "—"}
                </TableCell>
                <TableCell className="text-zinc-400">{u.email}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      u.status === "active"
                        ? "border-emerald-800 text-emerald-400"
                        : u.status === "suspended"
                          ? "border-amber-800 text-amber-400"
                          : "border-red-800 text-red-400"
                    }
                  >
                    {u.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-gray-500 tabular-nums">
                  {new Date(u.created_at).toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-gray-700 text-zinc-200 hover:border-indigo-600 hover:bg-indigo-600/10 hover:text-indigo-200"
                    onClick={() => openEdit(u)}
                    aria-label={`Edit ${u.email}`}
                  >
                    <Pencil className="mr-1.5 size-3.5" aria-hidden />
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="border-emerald-900/35 bg-zinc-900/75 backdrop-blur-sm text-zinc-100 sm:max-w-md">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle className="text-zinc-50">Create client user</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="create-org-name" className="text-zinc-300">
                  Organization name
                </Label>
                <Input
                  id="create-org-name"
                  autoComplete="organization"
                  value={form.organizationName}
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((f) => ({ ...f, organizationName: v }));
                    if (errors.organizationName) {
                      setErrors((prev) => ({
                        ...prev,
                        organizationName: validateOrganizationName(v),
                      }));
                    }
                  }}
                  onBlur={() => validateField("organizationName")}
                  aria-invalid={Boolean(errors.organizationName)}
                  aria-describedby={
                    errors.organizationName ? "create-org-name-error" : undefined
                  }
                  className={cn(
                    "border-gray-700 bg-[#0F172A] text-zinc-50",
                    errors.organizationName &&
                      "border-red-500 ring-1 ring-red-500/40 focus-visible:ring-red-500/50",
                  )}
                  placeholder="Acme Inc"
                />
                {errors.organizationName && (
                  <p id="create-org-name-error" className="text-sm text-red-400" role="alert">
                    {errors.organizationName}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-email" className="text-zinc-300">
                  Email
                </Label>
                <Input
                  id="create-email"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((f) => ({ ...f, email: v }));
                    if (errors.email) {
                      setErrors((prev) => ({ ...prev, email: validateEmail(v) }));
                    }
                  }}
                  onBlur={() => validateField("email")}
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? "create-email-error" : undefined}
                  className={cn(
                    "border-gray-700 bg-[#0F172A] text-zinc-50",
                    errors.email &&
                      "border-red-500 ring-1 ring-red-500/40 focus-visible:ring-red-500/50",
                  )}
                  placeholder="user@company.com"
                />
                {errors.email && (
                  <p id="create-email-error" className="text-sm text-red-400" role="alert">
                    {errors.email}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-password" className="text-zinc-300">
                  Temporary password
                </Label>
                <Input
                  id="create-password"
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((f) => ({ ...f, password: v }));
                    if (errors.password) {
                      setErrors((prev) => ({ ...prev, password: validatePassword(v) }));
                    }
                    if (errors.confirmPassword) {
                      setErrors((prev) => ({
                        ...prev,
                        confirmPassword: validateConfirmPassword(v, form.confirmPassword),
                      }));
                    }
                  }}
                  onBlur={() => validateField("password")}
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? "create-password-error" : undefined}
                  className={cn(
                    "border-gray-700 bg-[#0F172A] text-zinc-50",
                    errors.password &&
                      "border-red-500 ring-1 ring-red-500/40 focus-visible:ring-red-500/50",
                  )}
                  placeholder="At least 6 characters"
                />
                {errors.password && (
                  <p id="create-password-error" className="text-sm text-red-400" role="alert">
                    {errors.password}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-confirm-password" className="text-zinc-300">
                  Confirm password
                </Label>
                <Input
                  id="create-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={form.confirmPassword}
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((f) => ({ ...f, confirmPassword: v }));
                    if (errors.confirmPassword) {
                      setErrors((prev) => ({
                        ...prev,
                        confirmPassword: validateConfirmPassword(form.password, v),
                      }));
                    }
                  }}
                  onBlur={() => validateField("confirmPassword")}
                  aria-invalid={Boolean(errors.confirmPassword)}
                  aria-describedby={
                    errors.confirmPassword ? "create-confirm-password-error" : undefined
                  }
                  className={cn(
                    "border-gray-700 bg-[#0F172A] text-zinc-50",
                    errors.confirmPassword &&
                      "border-red-500 ring-1 ring-red-500/40 focus-visible:ring-red-500/50",
                  )}
                  placeholder="••••••••"
                />
                {errors.confirmPassword && (
                  <p id="create-confirm-password-error" className="text-sm text-red-400" role="alert">
                    {errors.confirmPassword}
                  </p>
                )}
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                className="border-gray-700"
                onClick={() => handleOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-500"
                disabled={isPending}
              >
                {isPending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={edit !== null} onOpenChange={handleEditOpenChange}>
        <DialogContent className="border-emerald-900/35 bg-zinc-900/75 backdrop-blur-sm text-zinc-100 sm:max-w-md">
          <form onSubmit={handleEditSubmit}>
            <DialogHeader>
              <DialogTitle className="text-zinc-50">Edit user email</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5 rounded-md border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-400">
                <div>
                  <span className="text-gray-500">Name: </span>
                  <span className="text-zinc-200">{edit?.user.full_name?.trim() || "—"}</span>
                </div>
                <div>
                  <span className="text-gray-500">Current email: </span>
                  <span className="font-mono text-zinc-200">{edit?.user.email}</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-email" className="text-zinc-300">
                  New email
                </Label>
                <Input
                  id="edit-email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  value={edit?.form.email ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEdit((prev) =>
                      prev ? { ...prev, form: { email: v }, error: undefined } : prev,
                    );
                  }}
                  aria-invalid={Boolean(edit?.error)}
                  aria-describedby={edit?.error ? "edit-email-error" : undefined}
                  className={cn(
                    "border-gray-700 bg-[#0F172A] text-zinc-50",
                    edit?.error &&
                      "border-red-500 ring-1 ring-red-500/40 focus-visible:ring-red-500/50",
                  )}
                  placeholder="new-address@domain.com"
                  disabled={isEditPending}
                />
                {edit?.error && (
                  <p id="edit-email-error" className="text-sm text-red-400" role="alert">
                    {edit.error}
                  </p>
                )}
                <p className="text-xs text-gray-500">
                  Updates both the Supabase auth record and the profile. The user will sign in
                  with the new address from now on.
                </p>
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                className="border-gray-700"
                onClick={() => handleEditOpenChange(false)}
                disabled={isEditPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-500"
                disabled={isEditPending}
              >
                {isEditPending ? "Saving…" : "Save email"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
