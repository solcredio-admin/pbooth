import { HttpStatus, Injectable } from "@nestjs/common";
import sharp from "sharp";
import { PrismaService } from "../prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { BoothsService } from "../booths/booths.service.js";
import { ApiError, notFound } from "../common/errors.js";

/** The page each frame covers, in pixels at 300 dpi: the same sizes as the kiosk's layouts (web lib/template/layout.ts). */
export function frameSize(layout: string, shots: number) {
  if (layout === "landscape" && shots >= 1 && shots <= 4) return { width: 1800, height: 1200 };
  if (layout === "strip" && shots >= 2 && shots <= 4) return { width: 600, height: 1800 };
  if (layout === "grid" && shots >= 1 && shots <= 4) return { width: 1200, height: 1800 };
  return null;
}

@Injectable()
export class FramesService {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService, private readonly booths: BoothsService) {}

  async put(eventId: string, layout: string, shots: number, file: Buffer, actor: string, ip?: string) {
    const size = frameSize(layout, shots);
    if (!size) throw new ApiError(HttpStatus.BAD_REQUEST, "NO_SUCH_LAYOUT", "There's no such layout");
    if (!(await this.db.event.count({ where: { id: eventId } }))) throw notFound("Event");
    const meta = await sharp(file).metadata().catch(() => null);
    if (meta?.format !== "png" || !meta.width || !meta.height) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, "NOT_PNG", "The frame must be a PNG");
    if (!meta.hasAlpha) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, "NO_WINDOWS", "The frame has no see-through areas, so it would cover the photos. Save it as a PNG with transparency");
    // the same shape as the page; any size of it is scaled to print size
    if (Math.abs(meta.width / meta.height - size.width / size.height) > 0.01) {
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, "WRONG_SHAPE", `This layout is ${size.width} × ${size.height} px (yours is ${meta.width} × ${meta.height}). Start from its template`);
    }
    const png = await sharp(file).resize(size.width, size.height, { fit: "fill" }).png({ compressionLevel: 9 }).toBuffer(); // also drops the file's metadata
    const [, frame] = await this.db.$transaction([
      this.db.eventFrame.deleteMany({ where: { eventId, layout, shots } }),
      this.db.eventFrame.create({ data: { eventId, layout, shots, ...size, png }, select: { id: true, layout: true, shots: true, width: true, height: true } }),
    ]);
    await this.audit.record({ actor, action: "event.frame.upload", entityType: "event", entityId: eventId, ip, metadata: { layout, shots, bytes: png.length } });
    await this.booths.pushForEvent(eventId);
    return frame;
  }

  async remove(eventId: string, layout: string, shots: number, actor: string, ip?: string) {
    const { count } = await this.db.eventFrame.deleteMany({ where: { eventId, layout, shots } });
    if (!count) throw notFound("Frame");
    await this.audit.record({ actor, action: "event.frame.remove", entityType: "event", entityId: eventId, ip, metadata: { layout, shots } });
    await this.booths.pushForEvent(eventId);
    return { removed: true };
  }

  async file(id: string) {
    const f = await this.db.eventFrame.findUnique({ where: { id }, select: { png: true } });
    if (!f) throw notFound("Frame");
    return Buffer.from(f.png);
  }
}
