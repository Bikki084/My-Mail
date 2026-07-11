"use client";

import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { isClientDashboardPreviewMode } from "@/lib/auth-config";
import { performClientSignOut } from "@/lib/auth/tab-session";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** First letter of first word + first letter of last word (UI helper). */
export function initialsFromFullName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    const w = parts[0]!;
    return w.length >= 2 ? w.slice(0, 2).toUpperCase() : `${w.charAt(0) ?? "?"}`.toUpperCase();
  }
  const first = parts[0]!.charAt(0);
  const last = parts[parts.length - 1]!.charAt(0);
  return `${first}${last}`.toUpperCase();
}

export function ProfileAvatar({
  fullName,
  className,
}: {
  fullName: string;
  className?: string;
}) {
  const initials = initialsFromFullName(fullName);
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-500/90 to-zinc-800 text-sm font-semibold text-white shadow-sm ring-1 ring-white/10",
        className,
      )}
      aria-hidden
    >
      {initials}
    </span>
  );
}

export function UserProfile({
  fullName = "Bikki Shaw",
  className,
  /** When false, hides quick links that duplicate the main /client tab bar (Wallet, Recipients, etc.). */
  showNavLinks = true,
}: {
  /** Display name used for initials and label — static until profiles are wired. */
  fullName?: string;
  className?: string;
  showNavLinks?: boolean;
}) {
  const router = useRouter();

  async function signOut() {
    if (isClientDashboardPreviewMode()) {
      router.push("/");
      router.refresh();
      return;
    }
    await performClientSignOut(router);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "group flex cursor-pointer items-center gap-2.5 rounded-lg border border-transparent py-1.5 pl-1 pr-2 outline-none transition-colors hover:border-zinc-700/80 hover:bg-zinc-800/60 data-[popup-open]:bg-zinc-800/80",
          className,
        )}
      >
        <ProfileAvatar fullName={fullName} />
        <span className="max-w-[180px] truncate text-left text-[15px] font-semibold tracking-tight text-zinc-100">
          {fullName}
        </span>
        <ChevronDown
          className="size-3.5 shrink-0 stroke-[1.5] text-zinc-500 opacity-90"
          aria-hidden
          strokeWidth={2}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-52">
        {showNavLinks ? (
          <>
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => {
                router.push("/client");
              }}
            >
              Email Campaign
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => {
                router.push("/client/overview");
              }}
            >
              Overview
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => {
                router.push("/client/campaigns");
              }}
            >
              Campaigns
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => {
                router.push("/client/smtp");
              }}
            >
              SMTP
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => {
                router.push("/client/recipients");
              }}
            >
              CSV & tags
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => {
                router.push("/client/deliverability");
              }}
            >
              Deliverability
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem
          className="cursor-pointer"
          onClick={() => {
            router.push("/client/overview");
          }}
        >
          Profile
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          className="cursor-pointer"
          onClick={() => void signOut()}
        >
          Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
