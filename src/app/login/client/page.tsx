import { redirect } from "next/navigation";

/** Convenience URL: `/login/client` → same as `/login?next=/client` */
export default function LoginClientRedirectPage() {
  redirect("/login?next=/client");
}
