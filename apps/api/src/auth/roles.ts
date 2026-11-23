import { SetMetadata } from "@nestjs/common";

export type Role = "OWNER" | "EVENTS" | "BOOTHS" | "KIOSK";
export const ROLES: Role[] = ["OWNER", "EVENTS", "BOOTHS", "KIOSK"];

// Who may call a route besides OWNER (who may call everything). A route without @Allow is
// OWNER-only, so anything new is closed until someone decides otherwise.
export const ALLOW = "allowRoles";
export const Allow = (...roles: Exclude<Role, "OWNER">[]) => SetMetadata(ALLOW, roles);
/** Any signed-in user: their own account (who am I, password, sign out). */
export const AnyRole = () => SetMetadata(ALLOW, ["EVENTS", "BOOTHS", "KIOSK"]);

export const allowed = (role: Role, allow: Role[] | undefined) => role === "OWNER" || !!allow?.includes(role);
