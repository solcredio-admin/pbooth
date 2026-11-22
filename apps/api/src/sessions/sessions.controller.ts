import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { Public } from "../auth/public.decorator.js";
import { KioskGuard, type KioskReq } from "../kiosk/kiosk.guard.js";
import { SessionsService } from "./sessions.service.js";

const id = { schema: z.string().uuid("Not a valid session id") };
const startSchema = z.object({ id: z.string().uuid(), startedAt: z.string().datetime().optional() });
const statusSchema = z.object({
  status: z.enum(["COMPLETED", "ABANDONED"]),
  photoCount: z.number().int().min(0).max(20).default(0),
  retakeCount: z.number().int().min(0).max(100).default(0),
});

@Controller("sessions")
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  // Kiosk: a guest starts a turn.
  @Public() @UseGuards(KioskGuard)
  @Post()
  start(@Body({ schema: startSchema }) body: z.infer<typeof startSchema>, @Req() r: KioskReq) {
    return this.sessions.start(r.kiosk!.boothId, body.id, body.startedAt);
  }

  // Kiosk: the turn ended (finished, or timed out / walked away).
  @Public() @UseGuards(KioskGuard)
  @Patch(":id/status")
  finish(@Param("id", id) sessionId: string, @Body({ schema: statusSchema }) body: z.infer<typeof statusSchema>, @Req() r: KioskReq) {
    return this.sessions.finish(r.kiosk!.boothId, sessionId, body);
  }

  // Admin.
  @Get(":id")
  get(@Param("id", id) sessionId: string) {
    return this.sessions.get(sessionId);
  }
}
