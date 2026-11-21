import { SetMetadata } from "@nestjs/common";

// Routes are private by default; this marks the few that anyone may call.
export const IS_PUBLIC = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC, true);
