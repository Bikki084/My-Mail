/** Phase 1 static mock data — replace with API/Supabase in Phase 2 */

export const mockDashboardStats = {
  clientAccounts: 24,
  activeCampaigns: 3,
  emailsSentToday: 128_400,
  creditsIssuedMonth: "₹4.2L",
};

export type MockUser = {
  id: string;
  name: string;
  email: string;
  status: "active" | "suspended" | "blocked";
};

export const mockUsers: MockUser[] = [
  { id: "1", name: "Northwind Trading", email: "ops@northwind.io", status: "active" },
  { id: "2", name: "Contoso Retail", email: "hello@contoso.com", status: "suspended" },
  { id: "3", name: "Fabrikam Labs", email: "team@fabrikam.dev", status: "active" },
  { id: "4", name: "Adventure Works", email: "mail@adventureworks.co", status: "blocked" },
];

export type MockPaymentNote = {
  id: string;
  user: string;
  amount: string;
  mode: string;
  date: string;
};

export const mockPaymentNotes: MockPaymentNote[] = [
  { id: "1", user: "Northwind Trading", amount: "₹12,000", mode: "UPI", date: "2026-04-10" },
  { id: "2", user: "Contoso Retail", amount: "₹5,500", mode: "Cash", date: "2026-04-12" },
  { id: "3", user: "Fabrikam Labs", amount: "₹20,000", mode: "UPI", date: "2026-04-14" },
];

export type MockCampaign = {
  id: string;
  name: string;
  client: string;
  status: string;
  emailsSent: number;
  date: string;
};

export const mockCampaigns: MockCampaign[] = [
  {
    id: "1",
    name: "Spring promo",
    client: "Northwind Trading",
    status: "completed",
    emailsSent: 12400,
    date: "2026-04-15",
  },
  {
    id: "2",
    name: "Newsletter Q2",
    client: "Fabrikam Labs",
    status: "sending",
    emailsSent: 8200,
    date: "2026-04-16",
  },
  {
    id: "3",
    name: "Onboarding drip",
    client: "Contoso Retail",
    status: "queued",
    emailsSent: 0,
    date: "2026-04-16",
  },
];

export type MockUsageRow = {
  id: string;
  user: string;
  emailsSent: number;
  creditsUsed: string;
  date: string;
};

export const mockUsage: MockUsageRow[] = [
  { id: "1", user: "Northwind Trading", emailsSent: 45000, creditsUsed: "42,100", date: "2026-04-01" },
  { id: "2", user: "Fabrikam Labs", emailsSent: 12800, creditsUsed: "12,800", date: "2026-04-01" },
  { id: "3", user: "Contoso Retail", emailsSent: 0, creditsUsed: "0", date: "2026-04-01" },
];

export type MockLoginEvent = {
  id: string;
  user: string;
  loginTime: string;
  logoutTime: string;
  ip: string;
};

export const mockLoginHistory: MockLoginEvent[] = [
  {
    id: "1",
    user: "ops@northwind.io",
    loginTime: "2026-04-16 09:12:04",
    logoutTime: "2026-04-16 17:45:22",
    ip: "103.21.45.88",
  },
  {
    id: "2",
    user: "team@fabrikam.dev",
    loginTime: "2026-04-16 08:01:11",
    logoutTime: "—",
    ip: "49.36.112.4",
  },
];

export type MockAnnouncement = {
  id: string;
  title: string;
  message: string;
  createdAt: string;
};

export const mockAnnouncements: MockAnnouncement[] = [
  {
    id: "1",
    title: "Scheduled maintenance",
    message: "SMTP pool upgrade Sunday 2am IST. Expect brief pauses.",
    createdAt: "2026-04-14",
  },
  {
    id: "2",
    title: "New rotation modes",
    message: "Threshold-based SMTP rotation is now available for enterprise plans.",
    createdAt: "2026-04-08",
  },
];
