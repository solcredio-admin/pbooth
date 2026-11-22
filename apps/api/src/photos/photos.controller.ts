import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { RouteConfig } from "@nestjs/platform-fastify";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { Public } from "../auth/public.decorator.js";
import { PhotosService } from "./photos.service.js";
import { BoothAuthGuard, type BoothReq } from "./booth-auth.guard.js";
import { StorageService } from "../storage/storage.service.js";
import type { Req as Request } from "../common/request.js";

const uuid = { schema: z.string().uuid() };
const authorizeSchema = z.object({
  photoId: z.string().uuid(), sessionId: z.string().uuid(),
  kind: z.enum(["ORIGINAL", "DESIGN"]), index: z.number().int().min(0).max(4),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "SHA-256 as 64 hex characters"),
  size: z.number().int().min(100),
  contentType: z.literal("image/jpeg"), // the booth always sends JPEG; the bytes are checked again later
});
const actor = (r: Request) => `admin:${r.admin!.id}`;

@Controller("photos")
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  // Booth (kiosk or agent)
  @Public() @UseGuards(BoothAuthGuard)
  @Post("upload-authorize") @HttpCode(200)
  @RouteConfig({ rateLimit: { max: 600, timeWindow: "1 minute" } })
  authorize(@Body({ schema: authorizeSchema }) b: z.infer<typeof authorizeSchema>, @Req() r: BoothReq) {
    return this.photos.authorize(r.booth!.boothId, b);
  }

  @Public() @UseGuards(BoothAuthGuard)
  @Post("upload-complete") @HttpCode(200)
  @RouteConfig({ rateLimit: { max: 600, timeWindow: "1 minute" } })
  complete(@Body({ schema: z.object({ photoId: z.string().uuid() }) }) b: { photoId: string }, @Req() r: BoothReq) {
    return this.photos.complete(r.booth!.boothId, b.photoId);
  }

  // Admin
  @Get(":id")
  get(@Param("id", uuid) id: string) { return this.photos.getPhoto(id); }

  @Delete(":id")
  remove(@Param("id", uuid) id: string, @Req() r: Request) { return this.photos.deletePhotos({ id }, actor(r), "deleted by admin"); }
}

@Controller("events/:eventId")
export class EventPhotosController {
  constructor(private readonly photos: PhotosService) {}

  @Get("photos")
  list(@Param("eventId", uuid) eventId: string, @Query({ schema: z.object({ page: z.coerce.number().int().min(1).default(1) }) }) q: { page: number }) {
    return this.photos.eventPhotos(eventId, q.page);
  }

  @Delete("photos")
  purge(@Param("eventId", uuid) eventId: string, @Req() r: Request) {
    return this.photos.deletePhotos({ eventId }, actor(r), "all event photos deleted by admin");
  }

  @Delete("sessions/:sessionId/photos")
  purgeSession(@Param("eventId", uuid) eventId: string, @Param("sessionId", uuid) sessionId: string, @Req() r: Request) {
    return this.photos.deletePhotos({ eventId, sessionId }, actor(r), "session photos deleted by admin");
  }

  @Post("gallery") @HttpCode(200)
  gallery(@Param("eventId", uuid) eventId: string, @Req() r: Request) { return this.photos.eventGallery(eventId, false, actor(r)); }

  @Post("gallery/rotate") @HttpCode(200)
  rotate(@Param("eventId", uuid) eventId: string, @Req() r: Request) { return this.photos.eventGallery(eventId, true, actor(r)); }

  /** ZIP of every processed design or original, streamed from the bucket. */
  @Get("export")
  async export(@Param("eventId", uuid) eventId: string, @Query({ schema: z.object({ kind: z.enum(["design", "original"]).default("design") }) }) q: { kind: "design" | "original" }, @Res() res: FastifyReply) {
    res.raw.writeHead(200, { "content-type": "application/zip", "content-disposition": `attachment; filename="pbooth-${eventId.slice(0, 8)}-${q.kind}s.zip"`, "cache-control": "no-store" });
    await this.photos.exportZip(eventId, q.kind === "design" ? "DESIGN" : "ORIGINAL", res.raw);
  }
}

@Controller("storage")
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Get("status")
  status() { return { enabled: this.storage.enabled, bucket: this.storage.enabled ? this.storage.bucket : null }; }

  @Post("check") @HttpCode(200)
  check() { return this.storage.check(); }
}
