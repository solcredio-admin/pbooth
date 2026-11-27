import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { EventsService } from "./events.service.js";
import { createEventSchema, listEventsSchema, updateEventSchema, type CreateEvent, type ListEvents, type UpdateEvent } from "./events.schemas.js";
import type { Req as Request } from "../common/request.js";
import { Allow } from "../auth/roles.js";

const id = { schema: z.string().uuid("Not a valid event id") };
const actor = (r: Request) => `admin:${r.admin!.id}`;
// cashiers and kiosk admins only ever see the events assigned to them
export const scope = (r: Request) => (r.admin!.role === "CASHIER" ? { cashierId: r.admin!.id } : r.admin!.role === "KIOSK" ? { kioskId: r.admin!.id } : undefined);
const cashiersSchema = z.object({ adminIds: z.array(z.string().uuid()).max(50) });
// Deleting needs the name typed back, so a stray click or replayed request can't do it.
const deleteSchema = z.object({ confirmName: z.string().min(1).max(200) });

@Allow("EVENTS")
@Controller("events")
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Allow("EVENTS", "BOOTHS", "SALES", "KIOSK", "CASHIER") // read-only for most; cashiers and kiosk admins see their own
  @Get()
  list(@Query({ schema: listEventsSchema }) q: ListEvents, @Req() r: Request) {
    return this.events.list(q, scope(r));
  }

  @Allow("EVENTS", "BOOTHS", "SALES", "KIOSK", "CASHIER")
  @Get("summary")
  summary(@Req() r: Request) {
    return this.events.summary(scope(r));
  }

  @Allow("EVENTS", "BOOTHS", "SALES", "KIOSK", "CASHIER")
  @Get(":id")
  get(@Param("id", id) eventId: string, @Req() r: Request) {
    return this.events.get(eventId, scope(r));
  }

  /** Which cashiers see this (self-service) event's vouchers and sales. Owner and super admin. */
  @Allow()
  @Put(":id/cashiers")
  setCashiers(@Param("id", id) eventId: string, @Body({ schema: cashiersSchema }) body: z.infer<typeof cashiersSchema>, @Req() r: Request) {
    return this.events.setCashiers(eventId, body.adminIds, actor(r), r.ip);
  }

  /** Which kiosk admins may open this event's kiosks. Owner and super admin. */
  @Allow()
  @Put(":id/kiosk-admins")
  setKioskAdmins(@Param("id", id) eventId: string, @Body({ schema: cashiersSchema }) body: z.infer<typeof cashiersSchema>, @Req() r: Request) {
    return this.events.setKioskAdmins(eventId, body.adminIds, actor(r), r.ip);
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
  schedule(@Param("id", id) eventId: string, @Req() r: Request) { return this.events.transition(eventId, "schedule", actor(r), r.ip); }

  @Post(":id/activate") @HttpCode(200)
  activate(@Param("id", id) eventId: string, @Req() r: Request) { return this.events.transition(eventId, "activate", actor(r), r.ip); }

  @Post(":id/complete") @HttpCode(200)
  complete(@Param("id", id) eventId: string, @Req() r: Request) { return this.events.transition(eventId, "complete", actor(r), r.ip); }

  @Post(":id/archive") @HttpCode(200)
  archive(@Param("id", id) eventId: string, @Req() r: Request) { return this.events.transition(eventId, "archive", actor(r), r.ip); }

  @Post(":id/delete") @HttpCode(200)
  remove(@Param("id", id) eventId: string, @Body({ schema: deleteSchema }) body: z.infer<typeof deleteSchema>, @Req() r: Request) {
    return this.events.remove(eventId, body.confirmName, actor(r), r.ip);
  }
}
