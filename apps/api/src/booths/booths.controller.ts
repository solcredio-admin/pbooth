import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { BoothsService } from "./booths.service.js";
import { SessionsService } from "../sessions/sessions.service.js";
import { assignSchema, createBoothSchema, updateBoothSchema, type CreateBooth, type UpdateBooth } from "./booths.schemas.js";
import type { Req as Request } from "../common/request.js";

const uuid = (what: string) => ({ schema: z.string().uuid(`Not a valid ${what} id`) });
const actor = (r: Request) => `admin:${r.admin!.id}`;

@Controller("booths")
export class BoothsController {
  constructor(private readonly booths: BoothsService) {}

  @Get()
  list() { return this.booths.list(); }

  @Post()
  create(@Body({ schema: createBoothSchema }) body: CreateBooth, @Req() r: Request) {
    return this.booths.create(body, actor(r), r.ip);
  }

  @Get(":id")
  get(@Param("id", uuid("booth")) id: string) { return this.booths.get(id); }

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

  @Post(":id/revoke") @HttpCode(200)
  revoke(@Param("id", uuid("booth")) id: string, @Req() r: Request) {
    return this.booths.revoke(id, actor(r), r.ip);
  }
}

@Controller("events/:eventId/booths")
export class EventBoothsController {
  constructor(private readonly booths: BoothsService, private readonly sessions: SessionsService) {}

  @Get()
  async list(@Param("eventId", uuid("event")) eventId: string) {
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
