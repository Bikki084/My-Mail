import { HomeAnimatedBackground } from "@/components/marketing/home-animated-background";
import { authPageClass } from "@/components/auth/auth-styles";

export function AuthPageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={authPageClass}>
      <HomeAnimatedBackground />
      {children}
    </div>
  );
}
