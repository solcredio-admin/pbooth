"use client";
import { createContext, useContext } from "react";

// Mirrors the API's roles (apps/api/src/auth/roles.ts and docs/ROADMAP.md 12.3). The API enforces them on every request;
// this only decides what to show, so a hidden button is never the only protection.
export * from "./role-rules";
import type { Me } from "./role-rules";

const MeContext = createContext<Me | null>(null);
export const MeProvider = MeContext.Provider;
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe outside the admin shell");
  return me;
}
