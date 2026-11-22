import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import { RouteConfig } from "@nestjs/platform-fastify";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Public } from "../auth/public.decorator.js";
import { DevicesService } from "./devices.service.js";
import { DeviceGuard, type DeviceReq } from "./device.guard.js";
import { ackSchema, enrollSchema, heartbeatSchema, type Enroll, type Heartbeat } from "./devices.schemas.js";

// Called by booth computers (the hardware agent, or the simulator), never by the admin browser.
@Public()
@Controller("devices")
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post("enroll") @HttpCode(200)
  @RouteConfig({ rateLimit: { max: 10, timeWindow: "15 minutes" } })
  enroll(@Body({ schema: enrollSchema }) body: Enroll, @Req() r: FastifyRequest) {
    return this.devices.enroll(body, r.ip);
  }

  @UseGuards(DeviceGuard)
  @Post("heartbeat") @HttpCode(200)
  heartbeat(@Body({ schema: heartbeatSchema }) body: Heartbeat, @Req() r: DeviceReq) {
    return this.devices.heartbeat(r.device!.id, r.device!.boothId, body, r.ip);
  }

  @UseGuards(DeviceGuard)
  @Get("config")
  config(@Req() r: DeviceReq) {
    return this.devices.config(r.device!.boothId);
  }

  @UseGuards(DeviceGuard)
  @Post("config/ack") @HttpCode(200)
  ack(@Body({ schema: ackSchema }) body: z.infer<typeof ackSchema>, @Req() r: DeviceReq) {
    return this.devices.ack(r.device!.id, r.device!.boothId, body.version);
  }
}
