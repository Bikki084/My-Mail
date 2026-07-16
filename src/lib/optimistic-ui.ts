import { toast } from "sonner";

/** Visible rollback when an optimistic UI update fails on the server. */
export function toastOptimisticRollback(actionLabel: string, error?: string): void {
  toast.error(`${actionLabel} — change reverted`, {
    description: error?.trim() || "The previous state was restored.",
  });
}
