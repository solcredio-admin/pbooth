import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { EventsService } from "./events.service.js";
import { createEventSchema, listEventsSchema, updateEventSchema, type CreateEvent, type ListEvents, type UpdateEvent } from "./events.schemas.js";
import type { Transition } from "./transitions.js";
import type { Req as Request } from "../common/request.js";

const id = { schema: z.string().uuid("Not a valid event id") };
const actor = (r: Request) => `admin:${r.admin!.id}`;

@Controller("events")
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list(@Query({ schema: listEventsSchema }) q: ListEvents) {
    return this.events.list(q);
  }

  @Get("summary")
  summary() {
    return this.events.summary();
  }

  @Get(":id")
  get(@Param("id", id) eventId: string) {
    return this.events.get(eventId);
  }

  @Post()
  create(@Body({ schema: createEventSchema }) body: CreateEvent, @Req() r: Request) {
    return this.events.create(body, actor(r), r.ip);
  }

  @Patch(":id")
  update(@Param("id", id) eventId: string, @Body({ schema: updateEventSchema }) body: UpdateEvent, @Req() r: Request) {
    return this.events.update(eventId, body, actor(r), r.ip);
  }

  @Post(":id/schedule") @HttpCode(200)
  schedule(@Param("id", id) eventId: string, @Req() r: Request) { return this.move(eventId, "schedule", r); }

  @Post(":id/activate") @HttpCode(200)
  activate(@Param("id", id) eventId: string, @Req() r: Request) { return this.move(eventId, "activate", r); }

  @Post(":id/complete") @HttpCode(200)
  complete(@Param("id", id) eventId: string, @Req() r: Request) { return this.move(eventId, "complete", r); }

  @Post(":id/archive") @HttpCode(200)
  archive(@Param("id", id) eventId: string, @Req() r: Request) { return this.move(eventId, "archive", r); }

  private move(eventId: string, t: Transition, r: Request) {
    return this.events.transition(eventId, t, actor(r), r.ip);
  }
}
