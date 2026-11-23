import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { RouteConfig } from "@nestjs/platform-fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { Public } from "../auth/public.decorator.js";
import { CONFIG, type Config } from "../config.js";
import { ApiError } from "../common/errors.js";
import { KioskService } from "./kiosk.service.js";
import { KIOSK_COOKIE, KIOSK_COOKIE_DAYS, KioskGuard, type KioskReq } from "./kiosk.guard.js";
import { kioskHeartbeatSchema, pairSchema, type KioskHeartbeat, type Pair } from "./kiosk.schemas.js";
import { SelfServiceService } from "../selfservice/selfservice.service.js";
const redeemSchema = z.object({ code: z.string().trim().min(4).max(20) });


// Called by the guest-facing kiosk page. Never exposes anything admin-only.
@Public()
@Controller("kiosk")
export class KioskController {
  constructor(private readonly kiosk: KioskService, private readonly ss: SelfServiceService, @Inject(CONFIG) private readonly cfg: Config) {}

  @Post("pair") @HttpCode(200)
  @RouteConfig({ rateLimit: { max: 10, timeWindow: "15 minutes" } })
  async pair(@Body({ schema: pairSchema }) body: Pair, @Req() r: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    const { token, booth } = await this.kiosk.pair(body, { ip: r.ip, userAgent: r.headers["user-agent"]?.slice(0, 300) });
    res.setCookie(KIOSK_COOKIE, token, {
      httpOnly: true, secure: this.cfg.cookieSecure, sameSite: "strict", path: "/", maxAge: KIOSK_COOKIE_DAYS * 86400,
    });
    return { booth };
  }

  /** The booth's current config, for the booth in the URL. A browser paired elsewhere gets 409. */
  @UseGuards(KioskGuard)
  @Get("config")
  async config(@Query({ schema: z.object({ booth: z.string().trim().toUpperCase() }) }) q: { booth: string }, @Req() r: KioskReq) {
    if (q.booth !== r.kiosk!.boothCode) {
      throw new ApiError(HttpStatus.CONFLICT, "WRONG_BOOTH", `This browser is paired with ${r.kiosk!.boothCode}`, { pairedWith: r.kiosk!.boothCode });
    }
    return this.kiosk.config(r.kiosk!.boothId);
  }

  @UseGuards(KioskGuard)
  @Post("agent-ticket") @HttpCode(200)
  agentTicket(@Req() r: KioskReq) {
    return this.kiosk.agentTicket(r.kiosk!.boothId);
  }

  /** A guest's voucher unlocks one session on this booth's self-service event. */
  @UseGuards(KioskGuard)
  @Post("redeem") @HttpCode(200)
  @RouteConfig({ rateLimit: { max: 30, timeWindow: "15 minutes" } })
  redeem(@Body({ schema: redeemSchema }) body: z.infer<typeof redeemSchema>, @Req() r: KioskReq) {
    return this.ss.redeem(r.kiosk!.boothId, body.code, r.ip);
  }

  @UseGuards(KioskGuard)
  @Post("heartbeat") @HttpCode(200)
  heartbeat(@Body({ schema: kioskHeartbeatSchema }) body: KioskHeartbeat, @Req() r: KioskReq) {
    return this.kiosk.heartbeat(r.kiosk!.id, r.kiosk!.boothId, body, r.headers["user-agent"]?.slice(0, 300));
  }
}
