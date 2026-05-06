import { createBrowserClient } from "@supabase/ssr";
import { supabaseProjectUrl } from "@/lib/supabase/project-url";

export function createClient() {
  return createBrowserClient(
    supabaseProjectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
