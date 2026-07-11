"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Send,
  Server,
  FileSpreadsheet,
  LogOut,
  Mail,
  ShieldCheck,
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
import { useRouter } from "next/navigation";
import { LoginEventBootstrap } from "@/components/auth/login-event-bootstrap";
import { TabSessionGuard } from "@/components/auth/tab-session-guard";
import { performClientSignOut } from "@/lib/auth/tab-session";
import { APP_BRAND_NAME } from "@/lib/brand";

const nav = [
  { href: "/client", label: "Dashboard", icon: LayoutDashboard },
  { href: "/client/campaigns", label: "Campaigns", icon: Send },
  { href: "/client/smtp", label: "SMTP servers", icon: Server },
  { href: "/client/recipients", label: "CSV & merge tags", icon: FileSpreadsheet },
  { href: "/client/deliverability", label: "Deliverability", icon: ShieldCheck },
];

export function ClientShell({
  userLabel,
  children,
}: {
  userLabel: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await performClientSignOut(router);
  }

  return (
    <SidebarProvider>
      <TabSessionGuard />
      <LoginEventBootstrap />
      <Sidebar collapsible="icon" variant="sidebar" className="border-r border-border">
        <SidebarHeader className="gap-3 border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Mail className="size-5" />
            </div>
            <div className="group-data-[collapsible=icon]:hidden">
              <p className="text-sm font-semibold tracking-tight">{APP_BRAND_NAME}</p>
              <p className="text-xs text-muted-foreground">Client</p>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Campaigns</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {nav.map((item) => {
                  const active =
                    item.href === "/client"
                      ? pathname === "/client"
                      : pathname.startsWith(item.href);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={active}
                        tooltip={item.label}
                        render={
                          <Link href={item.href}>
                            <item.icon />
                            <span>{item.label}</span>
                          </Link>
                        }
                      />
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarSeparator />
        </SidebarContent>
        <SidebarFooter className="border-t border-border/60 p-2">
          <div className="flex flex-col gap-2 px-2 py-1">
            <p className="truncate text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
              {userLabel}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => void signOut()}
            >
              <LogOut className="size-4" />
              <span className="group-data-[collapsible=icon]:hidden">Sign out</span>
            </Button>
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <div className="flex flex-1 items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">
              Bulk email — your workspace
            </p>
          </div>
        </header>
        <div className="flex-1 p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
