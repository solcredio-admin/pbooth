import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import { RouteConfig } from "@nestjs/platform-fastify";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { AuthService } from "./auth.service.js";
import { Public } from "./public.decorator.js";
import { SESSION_COOKIE } from "./tokens.js";
import { CONFIG, type Config } from "../config.js";
import { clientMeta, type Req as Request } from "../common/request.js";

const loginBody = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(256) });
const passwordBody = z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(1).max(256) });

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService, @Inject(CONFIG) private readonly cfg: Config) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  // Per-IP limit on top of the per-account limit in AuthService.
  @RouteConfig({ rateLimit: { max: 10, timeWindow: "15 minutes" } })
  async login(@Body({ schema: loginBody }) body: z.infer<typeof loginBody>, @Req() req: Request, @Res({ passthrough: true }) res: FastifyReply) {
    const { token, expiresAt, admin } = await this.auth.login(body.email, body.password, clientMeta(req));
    res.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,                 // JavaScript can't read it, so XSS can't steal it
      secure: this.cfg.cookieSecure,  // HTTPS-only whenever APP_ORIGIN is https
      sameSite: "strict",             // never sent on requests started by other sites
      path: "/",
      expires: expiresAt,
    });
    return { admin };
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: FastifyReply) {
    await this.auth.logout(req.admin!, req.ip);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
  }

  @Get("me")
  me(@Req() req: Request) {
    return { admin: { id: req.admin!.id, email: req.admin!.email } };
  }

  @Post("password")
  @HttpCode(204)
  @RouteConfig({ rateLimit: { max: 10, timeWindow: "15 minutes" } })
  async changePassword(@Body({ schema: passwordBody }) body: z.infer<typeof passwordBody>, @Req() req: Request) {
    await this.auth.changePassword(req.admin!, body.currentPassword, body.newPassword, req.ip);
  }
}
