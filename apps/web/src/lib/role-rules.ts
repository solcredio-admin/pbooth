// Who may do what, mirroring the API (apps/api/src/auth/roles.ts and docs/ROADMAP.md 12.3). Plain functions:
// usable by server pages and client components alike. The API enforces it; this only decides what to show.
export type Role = "OWNER" | "SUPER_ADMIN" | "EVENTS" | "BOOTHS" | "SALES" | "KIOSK" | "CASHIER";
export const ROLES: Role[] = ["OWNER", "SUPER_ADMIN", "EVENTS", "BOOTHS", "SALES", "KIOSK", "CASHIER"];
export interface Me { id: string; username: string; role: Role }

export const ROLE_LABEL: Record<Role, string> = { OWNER: "Owner", SUPER_ADMIN: "Super admin", EVENTS: "Event admin", BOOTHS: "Hardware admin", SALES: "Sales admin", KIOSK: "Kiosk admin", CASHIER: "Cashier" };
export const ROLE_HELP: Record<Role, string> = {
  OWNER: "Everything, including users and their roles",
  SUPER_ADMIN: "Everything except users and roles",
  EVENTS: "Events, their vouchers and galleries; sees booths and stations",
  BOOTHS: "Booths and stations, and opening kiosks; sees events",
  SALES: "Sees sales, refunds, events, booths and stations; changes nothing",
  KIOSK: "Opens the kiosks of the events assigned to them",
  CASHIER: "The vouchers, sales and help requests of the events assigned to them",
};

const top = (r: Role) => r === "OWNER" || r === "SUPER_ADMIN";
export const can = (role: Role) => ({
  editEvents: top(role) || role === "EVENTS", // create, edit, run events
  manageBooths: top(role) || role === "BOOTHS", // booths and stations
  bookBooths: top(role) || role === "EVENTS" || role === "BOOTHS", // put a booth on an event
  seeBooths: role !== "CASHIER",
  seeStations: top(role) || role === "BOOTHS" || role === "EVENTS" || role === "SALES",
  openKiosk: top(role) || role === "BOOTHS" || role === "KIOSK",
  seeSales: top(role) || role === "SALES", // the Sales tab
  eventMoney: top(role) || role === "SALES" || role === "CASHIER", // an event's totals and help requests
  vouchers: top(role) || role === "EVENTS" || role === "CASHIER", // make and void
  seeVouchers: top(role) || role === "EVENTS" || role === "CASHIER" || role === "SALES",
  refundMoney: top(role),
  assignPeople: top(role), // cashiers and kiosk admins on an event
  admin: top(role), // settings: alerts, backups, storage, audit log
  users: role === "OWNER",
});

