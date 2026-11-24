import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { Allow } from "../auth/roles.js";
import { scope } from "../events/events.controller.js";
import type { Req as Request } from "../common/request.js";
import { RefundsService } from "./refunds.service.js";

const listSchema = z.object({ status: z.enum(["open", "done"]).default("open"), eventId: z.string().uuid().optional() });
const resolveSchema = z.object({ action: z.enum(["PAYMONGO", "MANUAL", "VOUCHER", "REJECT"]), note: z.string().trim().max(300).optional() });

@Allow("EVENTS", "CASHIER")
@Controller("refunds")
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}
  @Get() list(@Query({ schema: listSchema }) q: z.infer<typeof listSchema>, @Req() r: Request) { return this.refunds.list(q, scope(r)); }
  @Post(":id/resolve") @HttpCode(200)
  resolve(@Param("id", { schema: z.string().uuid() }) id: string, @Body({ schema: resolveSchema }) b: z.infer<typeof resolveSchema>, @Req() r: Request) {
    return this.refunds.resolve(id, b, r.admin!, scope(r), r.ip);
  }
}
