"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LoginEventBootstrap } from "@/components/auth/login-event-bootstrap";
import { TabSessionGuard } from "@/components/auth/tab-session-guard";
import { performClientSignOut } from "@/lib/auth/tab-session";
import {
  LayoutDashboard,
  Users,
  Wallet,
  Receipt,
  Activity,
  BarChart3,
  History,
  Megaphone,
  LogOut,
  Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { APP_BRAND_NAME } from "@/lib/brand";

const nav: { href: string; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "User Management", icon: Users },
  { href: "/admin/credits/top-up", label: "Top-up Credits", icon: Wallet },
  { href: "/admin/payment-notes", label: "Payment Notes", icon: Receipt },
  { href: "/admin/monitor", label: "Sending Monitor", icon: Activity },
  { href: "/admin/reports", label: "Usage Reports", icon: BarChart3 },
  { href: "/admin/login-history", label: "Login History", icon: History },
  { href: "/admin/announcements", label: "Announcements", icon: Megaphone },
];

export function AdminShell({
  userLabel,
  children,
}: {
  userLabel: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    await performClientSignOut(router);
  }

  return (
    <SidebarProvider>
      <TabSessionGuard />
      <LoginEventBootstrap />
      <Sidebar collapsible="icon" className="border-r border-gray-800 bg-[#111827] text-gray-100">
        <SidebarHeader className="gap-3 border-b border-gray-800 px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-md">
              <Mail className="size-5 text-white" />
            </div>
            <div className="group-data-[collapsible=icon]:hidden">
              <p className="text-sm font-semibold tracking-tight text-white">{APP_BRAND_NAME}</p>
              <p className="text-xs text-gray-500">Admin Console</p>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent className="gap-0">
          <SidebarGroup>
            <SidebarGroupLabel className="text-[11px] uppercase tracking-wider text-gray-500">
              Navigation
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {nav.map((item) => {
                  const active =
                    item.href === "/admin"
                      ? pathname === "/admin"
                      : pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={active}
                        tooltip={item.label}
                        className={cn(
                          "text-gray-300 hover:bg-white/5 hover:text-white",
                          active && "bg-white/10 text-white",
                        )}
                        render={
                          <Link href={item.href}>
                            <item.icon className="size-4" />
                            <span className="group-data-[collapsible=icon]:hidden">{item.label}</span>
                          </Link>
                        }
                      />
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarSeparator className="bg-gray-800" />
        </SidebarContent>
        <SidebarFooter className="border-t border-gray-800 p-2">
          <div className="flex flex-col gap-2 px-2 py-1">
            <p className="truncate text-xs text-gray-500 group-data-[collapsible=icon]:hidden">
              {userLabel}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2 border-gray-700 bg-[#0F172A] text-gray-200 hover:bg-gray-800 hover:text-white"
              type="button"
              onClick={() => void handleSignOut()}
            >
              <LogOut className="size-4" />
              <span className="group-data-[collapsible=icon]:hidden">Sign out</span>
            </Button>
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="bg-[#0B0F19]">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-gray-800 bg-[#0B0F19]/95 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1 text-gray-400 hover:bg-white/5 hover:text-white" />
          <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
            <p className="truncate text-sm font-medium text-gray-400">Administration</p>
            <div className="flex items-center gap-3">
              <span className="hidden text-sm text-gray-300 sm:inline">{userLabel}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-gray-400 hover:bg-white/5 hover:text-white"
                onClick={() => void handleSignOut()}
              >
                Logout
              </Button>
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-6 text-gray-100">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
