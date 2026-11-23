"use client";
import { createContext, useContext } from "react";

// Mirrors the API's roles (apps/api/src/auth/roles.ts). The API enforces them on every request;
// this only decides what to show, so a hidden button is never the only protection.
export type Role = "OWNER" | "EVENTS" | "BOOTHS" | "KIOSK" | "CASHIER";
export interface Me { id: string; username: string; role: Role }

export const ROLE_LABEL: Record<Role, string> = { OWNER: "Super admin", EVENTS: "Event admin", BOOTHS: "Booth admin", KIOSK: "Kiosk operator", CASHIER: "Cashier" };
export const ROLE_HELP: Record<Role, string> = {
  OWNER: "Everything, including users, backups and storage",
  EVENTS: "Creates and runs events, galleries and exports",
  BOOTHS: "Manages booths; sees events but can't change them",
  KIOSK: "Sees events and booths; can only open a booth's kiosk",
  CASHIER: "Runs the self-service events assigned to them: vouchers and sales",
};

export const can = (role: Role) => ({
  editEvents: role === "OWNER" || role === "EVENTS", // create events, edit any
  runAssigned: role === "OWNER" || role === "EVENTS" || role === "CASHIER", // edit and run the events they can see
  manageBooths: role === "OWNER" || role === "BOOTHS",
  bookBooths: role !== "KIOSK" && role !== "CASHIER",
  seeBooths: role !== "EVENTS" && role !== "CASHIER",
  openKiosk: role !== "EVENTS" && role !== "CASHIER",
  admin: role === "OWNER",
});

const MeContext = createContext<Me | null>(null);
export const MeProvider = MeContext.Provider;
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe outside the admin shell");
  return me;
}
