import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { RouteConfig } from "@nestjs/platform-fastify";
import { z } from "zod";
import { Allow } from "../auth/roles.js";
import { Public } from "../auth/public.decorator.js";
import type { Req as Request } from "../common/request.js";
import { StationGuard, type StationReq } from "./station.guard.js";
import { StationsService } from "./stations.service.js";
import { boothStationsSchema, createStationSchema, moveSchema, pollSchema, reportSchema, updateStationSchema, type Poll, type Report, type UpdateStation } from "./stations.schemas.js";

const uuid = (what: string) => ({ schema: z.string().uuid(`Not a valid ${what} id`) });
const actor = (r: Request) => `admin:${r.admin!.id}`;
const jobsSchema = z.object({ status: z.enum(["open", "done"]).default("open"), stationId: z.string().uuid().optional() });
const deleteSchema = z.object({ confirmName: z.string().min(1).max(200) });

@Allow("BOOTHS")
@Controller("stations")
export class StationsController {
  constructor(private readonly stations: StationsService) {}

  @Get()
  list() { return this.stations.list(); }

  @Post()
  create(@Body({ schema: createStationSchema }) body: { name: string }, @Req() r: Request) { return this.stations.create(body.name, actor(r), r.ip); }

  @Get("jobs")
  jobs(@Query({ schema: jobsSchema }) q: z.infer<typeof jobsSchema>) { return this.stations.jobs(q); }

  @Post("jobs/:id/retry") @HttpCode(200)
  retry(@Param("id", uuid("print")) id: string, @Req() r: Request) { return this.stations.retry(id, actor(r), r.ip); }

  @Post("jobs/:id/move") @HttpCode(200)
  move(@Param("id", uuid("print")) id: string, @Body({ schema: moveSchema }) body: z.infer<typeof moveSchema>, @Req() r: Request) {
    return this.stations.move(id, body.stationId, body.confirm, actor(r), r.ip);
  }

  @Get(":id")
  get(@Param("id", uuid("station")) id: string) { return this.stations.get(id); }

  @Patch(":id")
  update(@Param("id", uuid("station")) id: string, @Body({ schema: updateStationSchema }) body: UpdateStation, @Req() r: Request) { return this.stations.update(id, body, actor(r), r.ip); }

  @Post(":id/enrollment-code") @HttpCode(200)
  code(@Param("id", uuid("station")) id: string, @Req() r: Request) { return this.stations.enrollmentCode(id, actor(r), r.ip); }

  @Post(":id/sign-out") @HttpCode(200)
  signOut(@Param("id", uuid("station")) id: string, @Req() r: Request) { return this.stations.signOut(id, actor(r), r.ip); }

  @Post(":id/delete") @HttpCode(200)
  remove(@Param("id", uuid("station")) id: string, @Body({ schema: deleteSchema }) body: z.infer<typeof deleteSchema>, @Req() r: Request) { return this.stations.remove(id, body.confirmName, actor(r), r.ip); }
}

@Allow("BOOTHS")
@Controller("booths/:boothId/stations")
export class BoothStationsController {
  constructor(private readonly stations: StationsService) {}

  @Put()
  set(@Param("boothId", uuid("booth")) boothId: string, @Body({ schema: boothStationsSchema }) body: z.infer<typeof boothStationsSchema>, @Req() r: Request) {
    return this.stations.setForBooth(boothId, body.stationIds, body.mode, actor(r), r.ip);
  }
}

// Called by the station's agent.
@Public()
@UseGuards(StationGuard)
@Controller("station")
export class StationAgentController {
  constructor(private readonly stations: StationsService) {}

  // its own allowance: several stations at one venue share an address and ask every 2 seconds
  @Post("poll") @HttpCode(200)
  @RouteConfig({ rateLimit: { max: 900, timeWindow: "1 minute" } })
  poll(@Body({ schema: pollSchema }) body: Poll, @Req() r: StationReq) { return this.stations.poll(r.station!.id, body); }

  @Post("jobs/:id") @HttpCode(200)
  report(@Param("id", uuid("print")) id: string, @Body({ schema: reportSchema }) body: Report, @Req() r: StationReq) { return this.stations.report(r.station!.id, id, body); }
}
