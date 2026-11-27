import { Body, Controller, Delete, Get, Header, Param, Put, Req } from "@nestjs/common";
import { z } from "zod";
import { Allow } from "../auth/roles.js";
import { Public } from "../auth/public.decorator.js";
import type { Req as Request } from "../common/request.js";
import { ApiError } from "../common/errors.js";
import { FramesService } from "./frames.service.js";

const uuid = { schema: z.string().uuid() };
const layout = { schema: z.enum(["landscape", "strip", "grid"]) };
const shots = { schema: z.coerce.number().int().min(1).max(4) };

@Allow("EVENTS")
@Controller("events/:eventId/frames")
export class EventFramesController {
  constructor(private readonly frames: FramesService) {}

  /** The PNG itself is the body (Content-Type: image/png). */
  @Put(":layout/:shots")
  put(@Param("eventId", uuid) eventId: string, @Param("layout", layout) l: string, @Param("shots", shots) n: number, @Body() file: unknown, @Req() r: Request) {
    if (!Buffer.isBuffer(file)) throw new ApiError(415, "NOT_PNG", "Send the frame as image/png");
    return this.frames.put(eventId, l, n, file, `admin:${r.admin!.id}`, r.ip);
  }

  @Delete(":layout/:shots")
  remove(@Param("eventId", uuid) eventId: string, @Param("layout", layout) l: string, @Param("shots", shots) n: number, @Req() r: Request) {
    return this.frames.remove(eventId, l, n, `admin:${r.admin!.id}`, r.ip);
  }
}

// Kiosks and the admin preview draw frames on a canvas, so they come from this origin. Not secret: an
// overlay with holes in it. A new upload gets a new id, so a frame never changes under its URL.
@Public()
@Controller("frames")
export class FramesController {
  constructor(private readonly frames: FramesService) {}

  @Get(":id")
  @Header("content-type", "image/png")
  @Header("cache-control", "public, max-age=31536000, immutable")
  file(@Param("id", uuid) id: string) { return this.frames.file(id); }
}
