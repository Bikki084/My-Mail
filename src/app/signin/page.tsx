import { redirect } from "next/navigation";

/** Legacy alias; use `/login` as the canonical sign-in URL. */
export default function SignInPage() {
  redirect("/login");
}
