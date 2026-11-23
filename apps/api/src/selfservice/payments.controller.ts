import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { RouteConfig } from "@nestjs/platform-fastify";
import { Public } from "../auth/public.decorator.js";
import { SelfServiceService } from "./selfservice.service.js";

// PayMongo calls this when a payment changes. Public by necessity, and safe: it only makes pbooth
// re-check that payment with PayMongo (with the secret key); nothing in the body is trusted.
@Public()
@Controller("payments")
export class PaymentsController {
  constructor(private readonly ss: SelfServiceService) {}

  @Post("paymongo/webhook") @HttpCode(200)
  @RouteConfig({ rateLimit: { max: 120, timeWindow: "1 minute" } })
  webhook(@Body() body: unknown) {
    return this.ss.webhook(body);
  }
}
