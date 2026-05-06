"use client";

import * as React from "react";
import type { WalletState } from "@/app/actions/wallet";
import { useActivePlanTimer } from "@/components/client/email-campaign/use-active-plan-timer";

export type WalletStateContextValue = {
  state: WalletState;
  setState: React.Dispatch<React.SetStateAction<WalletState>>;
  /** Single shared countdown for the active plan (header + tab). */
  timer: ReturnType<typeof useActivePlanTimer>;
};

const Ctx = React.createContext<WalletStateContextValue | null>(null);

/**
 * Shared wallet + active plan state for the client campaign console. Keeps
 * the header timer and the Wallet & Plan tab in sync when the user activates
 * a plan or when state refreshes from the server. The active-plan tick runs
 * once here so the header and tab share the same clock.
 */
export function WalletStateProvider({
  initial,
  children,
}: {
  initial: WalletState;
  children: React.ReactNode;
}) {
  const [state, setState] = React.useState<WalletState>(initial);
  const [lastInitial, setLastInitial] = React.useState(initial);
  if (lastInitial !== initial) {
    setLastInitial(initial);
    setState(initial);
  }
  const timer = useActivePlanTimer(state.activePlan);
  const value: WalletStateContextValue = { state, setState, timer };
  return <Ctx value={value}>{children}</Ctx>;
}

export function useWalletState() {
  const v = React.useContext(Ctx);
  if (!v) {
    throw new Error("useWalletState must be used within WalletStateProvider");
  }
  return v;
}
