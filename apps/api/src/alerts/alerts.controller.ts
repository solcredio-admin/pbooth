import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { z } from "zod";
import type { Req as Request } from "../common/request.js";
import { ALERT_KINDS, AlertsService } from "./alerts.service.js";

const id = { schema: z.string().uuid() };
const chatSchema = z.object({ chatId: z.string().trim().regex(/^-?\d{1,20}$/, "A chat id is a number"), label: z.string().trim().min(1).max(60) });
const kindsSchema = z.object({ kinds: z.array(z.enum(ALERT_KINDS)) });

// Owner only (no @Allow).
@Controller("alerts")
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}
  @Get() status() { return this.alerts.status(); }
  @Get("find-chats") find() { return this.alerts.findChats(); }
  @Post("chats") add(@Body({ schema: chatSchema }) b: z.infer<typeof chatSchema>, @Req() r: Request) { return this.alerts.addChat(b, `admin:${r.admin!.id}`, r.ip); }
  @Patch("chats/:id") kinds(@Param("id", id) cid: string, @Body({ schema: kindsSchema }) b: z.infer<typeof kindsSchema>) { return this.alerts.setKinds(cid, b.kinds); }
  @Delete("chats/:id") remove(@Param("id", id) cid: string, @Req() r: Request) { return this.alerts.removeChat(cid, `admin:${r.admin!.id}`, r.ip); }
  @Post("chats/:id/test") @HttpCode(200) test(@Param("id", id) cid: string) { return this.alerts.test(cid); }
}
