/**
 * Canonical admin login email (bootstrap). Must match Supabase Auth + profiles.email.
 */
export const DEFAULT_ADMIN_EMAIL = "mymail87455@gmail.com";

export function getBootstrapAdminEmail(): string {
  const fromEnv = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_ADMIN_EMAIL;
}
