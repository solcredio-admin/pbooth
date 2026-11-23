import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthService } from "./auth.service.js";
import { IS_PUBLIC } from "./public.decorator.js";
import { ALLOW, allowed, type Role } from "./roles.js";
import { SESSION_COOKIE } from "./tokens.js";
import { ApiError } from "../common/errors.js";
import type { Req } from "../common/request.js";

// Applied to every route: no valid session → 401 (unless @Public()); a role the route doesn't
// allow → 403. Routes are OWNER-only unless they say @Allow(...).
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<Req>();
    const admin = await this.auth.resolve(req.cookies?.[SESSION_COOKIE]);
    if (!admin) throw new ApiError(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Sign in required");
    const allow = this.reflector.getAllAndOverride<Role[] | undefined>(ALLOW, [ctx.getHandler(), ctx.getClass()]);
    if (!allowed(admin.role, allow)) throw new ApiError(HttpStatus.FORBIDDEN, "FORBIDDEN", "Your account can't do that");
    req.admin = admin;
    return true;
  }
}
