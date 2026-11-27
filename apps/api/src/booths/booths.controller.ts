import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { BoothsService } from "./booths.service.js";
import { SessionsService } from "../sessions/sessions.service.js";
import { assignSchema, createBoothSchema, updateBoothSchema, type CreateBooth, type UpdateBooth } from "./booths.schemas.js";
import type { Req as Request } from "../common/request.js";
import { Allow } from "../auth/roles.js";
import { KioskService } from "../kiosk/kiosk.service.js";
import { KIOSK_COOKIE, KIOSK_COOKIE_DAYS } from "../kiosk/kiosk.guard.js";
import { CONFIG, type Config } from "../config.js";
import { clientMeta } from "../common/request.js";
import { EventsService } from "../events/events.service.js";
import { scope } from "../events/events.controller.js";

const uuid = (what: string) => ({ schema: z.string().uuid(`Not a valid ${what} id`) });
const actor = (r: Request) => `admin:${r.admin!.id}`;
const kioskOf = (r: Request) => (r.admin!.role === "KIOSK" ? r.admin!.id : undefined);
// Deleting needs the name typed back, so a stray click or replayed request can't do it.
const staffPinSchema = z.object({ pin: z.string().regex(/^\d{4,8}$/, "4 to 8 digits").nullable() });
const deleteSchema = z.object({ confirmName: z.string().min(1).max(200) });

@Allow("BOOTHS")
@Controller("booths")
export class BoothsController {
  constructor(private readonly booths: BoothsService, private readonly kiosk: KioskService, @Inject(CONFIG) private readonly cfg: Config) {}

  // event and sales admins see the booths; kiosk admins only those on their events
  @Allow("EVENTS", "BOOTHS", "SALES", "KIOSK")
  @Get()
  list(@Req() r: Request) { return this.booths.list(kioskOf(r)); }

  @Post()
  create(@Body({ schema: createBoothSchema }) body: CreateBooth, @Req() r: Request) {
    return this.booths.create(body, actor(r), r.ip);
  }

  @Allow("EVENTS", "BOOTHS", "SALES", "KIOSK")
  @Get(":id")
  async get(@Param("id", uuid("booth")) id: string, @Req() r: Request) {
    await this.booths.assertKioskMay(id, kioskOf(r));
    return this.booths.get(id);
  }

  @Patch(":id")
  update(@Param("id", uuid("booth")) id: string, @Body({ schema: updateBoothSchema }) body: UpdateBooth, @Req() r: Request) {
    return this.booths.update(id, body, actor(r), r.ip);
  }

  @Post(":id/enrollment-code") @HttpCode(200)
  enrollmentCode(@Param("id", uuid("booth")) id: string, @Req() r: Request) {
    return this.booths.enrollmentCode(id, actor(r), r.ip);
  }

  @Post(":id/kiosk-code") @HttpCode(200)
  kioskCode(@Param("id", uuid("booth")) id: string, @Req() r: Request) {
    return this.booths.kioskCode(id, actor(r), r.ip);
  }

  @Post(":id/kiosk/unpair") @HttpCode(200)
  unpairKiosk(@Param("id", uuid("booth")) id: string, @Req() r: Request) {
    return this.booths.unpairKiosk(id, actor(r), r.ip);
  }

  /** The PIN for the kiosk's hidden staff menu; null removes it. */
  @Post(":id/staff-pin") @HttpCode(200)
  staffPin(@Param("id", uuid("booth")) id: string, @Body({ schema: staffPinSchema }) body: z.infer<typeof staffPinSchema>, @Req() r: Request) {
    return this.booths.setStaffPin(id, body.pin, actor(r), r.ip);
  }

  @Post(":id/revoke") @HttpCode(200)
  revoke(@Param("id", uuid("booth")) id: string, @Req() r: Request) {
    return this.booths.revoke(id, actor(r), r.ip);
  }

  /** Pairs the browser making this request as the booth's kiosk (the signed-in user is the proof). */
  @Allow("BOOTHS", "KIOSK")
  @Post(":id/kiosk/launch") @HttpCode(200)
  async launchKiosk(@Param("id", uuid("booth")) id: string, @Req() r: Request, @Res({ passthrough: true }) res: FastifyReply) {
    await this.booths.assertKioskMay(id, kioskOf(r));
    const { token, booth } = await this.kiosk.pairSignedIn(id, actor(r), clientMeta(r));
    res.setCookie(KIOSK_COOKIE, token, { httpOnly: true, secure: this.cfg.cookieSecure, sameSite: "strict", path: "/", maxAge: KIOSK_COOKIE_DAYS * 86400 });
    return { booth };
  }

  @Post(":id/delete") @HttpCode(200)
  remove(@Param("id", uuid("booth")) id: string, @Body({ schema: deleteSchema }) body: z.infer<typeof deleteSchema>, @Req() r: Request) {
    return this.booths.remove(id, body.confirmName, actor(r), r.ip);
  }
}

// Event admins and hardware admins put booths on events; everyone who sees an event sees its booths.
@Allow("EVENTS", "BOOTHS")
@Controller("events/:eventId/booths")
export class EventBoothsController {
  constructor(private readonly booths: BoothsService, private readonly sessions: SessionsService, private readonly events: EventsService) {}

  @Allow("EVENTS", "BOOTHS", "SALES", "KIOSK")
  @Get()
  async list(@Param("eventId", uuid("event")) eventId: string, @Req() r: Request) {
    if (r.admin!.role === "KIOSK") await this.events.get(eventId, scope(r)); // their events only
    const [booths, sessions] = await Promise.all([this.booths.boothsForEvent(eventId), this.sessions.stats(eventId)]);
    return { ...booths, sessions };
  }

  @Post() @HttpCode(200)
  assign(@Param("eventId", uuid("event")) eventId: string, @Body({ schema: assignSchema }) body: z.infer<typeof assignSchema>, @Req() r: Request) {
    return this.booths.assign(eventId, body.boothId, actor(r), r.ip);
  }

  @Delete(":boothId")
  unassign(@Param("eventId", uuid("event")) eventId: string, @Param("boothId", uuid("booth")) boothId: string, @Req() r: Request) {
    return this.booths.unassign(eventId, boothId, actor(r), r.ip);
  }
}
