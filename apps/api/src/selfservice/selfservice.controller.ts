import { Body, Controller, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { SelfServiceService, createVouchersSchema } from "./selfservice.service.js";
import { Allow } from "../auth/roles.js";
import { scope } from "../events/events.controller.js";
import type { Req as Request } from "../common/request.js";

const uuid = (what: string) => ({ schema: z.string().uuid(`Not a valid ${what} id`) });

// Vouchers of one self-service event: event admins and that event's cashiers make and void them; sales admins
// see them. Its money totals: sales admins and its cashiers (and owner, super admin).
@Allow("EVENTS", "CASHIER")
@Controller("events/:eventId")
export class SelfServiceController {
  constructor(private readonly ss: SelfServiceService) {}

  @Allow("EVENTS", "SALES", "CASHIER")
  @Get("vouchers")
  list(@Param("eventId", uuid("event")) eventId: string, @Req() r: Request) {
    return this.ss.listVouchers(eventId, scope(r));
  }

  @Post("vouchers")
  create(@Param("eventId", uuid("event")) eventId: string, @Body({ schema: createVouchersSchema }) body: z.infer<typeof createVouchersSchema>, @Req() r: Request) {
    return this.ss.createVouchers(eventId, body, r.admin!, scope(r), r.ip);
  }

  @Post("vouchers/:voucherId/void") @HttpCode(200)
  void(@Param("eventId", uuid("event")) eventId: string, @Param("voucherId", uuid("voucher")) voucherId: string, @Req() r: Request) {
    return this.ss.voidVoucher(eventId, voucherId, r.admin!, scope(r), r.ip);
  }

  @Allow("SALES", "CASHIER")
  @Get("revenue")
  revenue(@Param("eventId", uuid("event")) eventId: string, @Req() r: Request) {
    return this.ss.revenue(eventId, scope(r));
  }
}
