import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import { ApiError } from "../common/errors.js";
import { z } from "zod";
import { EventsService } from "./events.service.js";
import { createEventSchema, listEventsSchema, updateEventSchema, type CreateEvent, type ListEvents, type UpdateEvent } from "./events.schemas.js";
import type { Transition } from "./transitions.js";
import type { Req as Request } from "../common/request.js";
import { Allow } from "../auth/roles.js";

const id = { schema: z.string().uuid("Not a valid event id") };
const actor = (r: Request) => `admin:${r.admin!.id}`;
// cashiers only ever see the events assigned to them
export const scope = (r: Request) => (r.admin!.role === "CASHIER" ? { cashierId: r.admin!.id } : undefined);
const cashiersSchema = z.object({ adminIds: z.array(z.string().uuid()).max(50) });
// Deleting needs the name typed back, so a stray click or replayed request can't do it.
const deleteSchema = z.object({ confirmName: z.string().min(1).max(200) });

@Allow("EVENTS")
@Controller("events")
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Allow("EVENTS", "BOOTHS", "KIOSK", "CASHIER") // read-only for booth admins and kiosk operators; cashiers see their own
  @Get()
  list(@Query({ schema: listEventsSchema }) q: ListEvents, @Req() r: Request) {
    return this.events.list(q, scope(r));
  }

  @Allow("EVENTS", "BOOTHS", "KIOSK", "CASHIER")
  @Get("summary")
  summary(@Req() r: Request) {
    return this.events.summary(scope(r));
  }

  @Allow("EVENTS", "BOOTHS", "KIOSK", "CASHIER")
  @Get(":id")
  get(@Param("id", id) eventId: string, @Req() r: Request) {
    return this.events.get(eventId, scope(r));
  }

  /** Which cashier accounts manage this (self-service) event. Super admin only. */
  @Allow()
  @Put(":id/cashiers")
  setCashiers(@Param("id", id) eventId: string, @Body({ schema: cashiersSchema }) body: z.infer<typeof cashiersSchema>, @Req() r: Request) {
    return this.events.setCashiers(eventId, body.adminIds, actor(r), r.ip);
  }

  @Post()
  create(@Body({ schema: createEventSchema }) body: CreateEvent, @Req() r: Request) {
    return this.events.create(body, actor(r), r.ip);
  }

  // cashiers edit and run their own events, but price and revenue share stay with the owner
  @Allow("EVENTS", "CASHIER")
  @Patch(":id")
  async update(@Param("id", id) eventId: string, @Body({ schema: updateEventSchema }) body: UpdateEvent, @Req() r: Request) {
    if (r.admin!.role === "CASHIER") {
      await this.events.get(eventId, scope(r));
      if (body.kind !== undefined || body.priceCentavos !== undefined || body.partnerName !== undefined || body.partnerSharePercent !== undefined) {
        throw new ApiError(HttpStatus.FORBIDDEN, "FORBIDDEN", "Only the owner changes the event type, price or revenue share");
      }
    }
    return this.events.update(eventId, body, actor(r), r.ip);
  }

  @Allow("EVENTS", "CASHIER")
  @Post(":id/schedule") @HttpCode(200)
  schedule(@Param("id", id) eventId: string, @Req() r: Request) { return this.move(eventId, "schedule", r); }

  @Allow("EVENTS", "CASHIER")
  @Post(":id/activate") @HttpCode(200)
  activate(@Param("id", id) eventId: string, @Req() r: Request) { return this.move(eventId, "activate", r); }

  @Allow("EVENTS", "CASHIER")
  @Post(":id/complete") @HttpCode(200)
  complete(@Param("id", id) eventId: string, @Req() r: Request) { return this.move(eventId, "complete", r); }

  @Allow("EVENTS", "CASHIER")
  @Post(":id/archive") @HttpCode(200)
  archive(@Param("id", id) eventId: string, @Req() r: Request) { return this.move(eventId, "archive", r); }

  private async move(eventId: string, t: Transition, r: Request) {
    if (r.admin!.role === "CASHIER") await this.events.get(eventId, scope(r)); // only their own events
    return this.events.transition(eventId, t, actor(r), r.ip);
  }

  @Post(":id/delete") @HttpCode(200)
  remove(@Param("id", id) eventId: string, @Body({ schema: deleteSchema }) body: z.infer<typeof deleteSchema>, @Req() r: Request) {
    return this.events.remove(eventId, body.confirmName, actor(r), r.ip);
  }
}
