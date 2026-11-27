import { SetMetadata } from "@nestjs/common";

export type Role = "OWNER" | "SUPER_ADMIN" | "EVENTS" | "BOOTHS" | "SALES" | "KIOSK" | "CASHIER";
export const ROLES: Role[] = ["OWNER", "SUPER_ADMIN", "EVENTS", "BOOTHS", "SALES", "KIOSK", "CASHIER"];
/** Owner and super admin: everything (the super admin except users and roles). */
export const isTop = (role: Role) => role === "OWNER" || role === "SUPER_ADMIN";

// Who may call a route besides OWNER and SUPER_ADMIN (who may call everything, except @OwnerOnly routes
// for the super admin). A route without @Allow is theirs alone, so anything new is closed until someone decides.
export const ALLOW = "allowRoles";
export const Allow = (...roles: Exclude<Role, "OWNER" | "SUPER_ADMIN">[]) => SetMetadata(ALLOW, roles);
/** Users and roles: the owner only. */
export const OWNER_ONLY = "ownerOnly";
export const OwnerOnly = (on = true) => SetMetadata(OWNER_ONLY, on);
/** Any signed-in user: their own account (who am I, password, sign out). */
export const AnyRole = () => SetMetadata(ALLOW, ["EVENTS", "BOOTHS", "SALES", "KIOSK", "CASHIER"]);

export const allowed = (role: Role, allow: Role[] | undefined, ownerOnly = false) =>
  role === "OWNER" || (role === "SUPER_ADMIN" && !ownerOnly) || (!ownerOnly && !!allow?.includes(role));
