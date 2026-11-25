import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import { RouteConfig } from "@nestjs/platform-fastify";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { Public } from "../auth/public.decorator.js";
import { GalleriesService } from "./galleries.service.js";

const token = { schema: z.string().regex(/^[A-Za-z0-9_-]{32,64}$/, "Not a gallery link") };

// Guests, from the QR code. No account; the unguessable token is the key.
@Public()
@Controller("galleries")
export class GalleriesController {
  constructor(private readonly galleries: GalleriesService) {}

  @Get(":token")
  @RouteConfig({ rateLimit: { max: 120, timeWindow: "1 minute" } })
  meta(@Param("token", token) t: string) { return this.galleries.meta(t); }

  /** Everything on this link, as one ZIP. */
  @Get(":token/zip")
  @RouteConfig({ rateLimit: { max: 10, timeWindow: "10 minutes" } })
  async zip(@Param("token", token) t: string, @Res() res: FastifyReply) {
    const { name, photos } = await this.galleries.zip(t); // a bad link is still a normal 404
    res.hijack();
    res.raw.writeHead(200, { "content-type": "application/zip", "content-disposition": `attachment; filename="${name}.zip"`, "cache-control": "no-store" });
    await this.galleries.stream(photos, res.raw);
  }

  @Get(":token/photos")
  @RouteConfig({ rateLimit: { max: 120, timeWindow: "1 minute" } })
  photos(@Param("token", token) t: string, @Query({ schema: z.object({ page: z.coerce.number().int().min(1).max(500).default(1) }) }) q: { page: number }) {
    return this.galleries.photos(t, q.page);
  }
}
