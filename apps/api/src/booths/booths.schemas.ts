import { z } from "zod";

// Camera settings the admin picks. Hardware-specific options (flash, ISO...) come with the agent
// in Phase 4, once real cameras report what they support.
export const cameraSchema = z.object({
  provider: z.enum(["webcam", "gphoto2"]).default("webcam"),
  deviceName: z.string().trim().max(160).nullable().default(null), // as reported by the booth; null = first available
  resolution: z.enum(["auto", "720p", "1080p", "4k"]).default("auto"),
  // The booth's screen: landscape = 16:9, portrait = 9:16. Preview and photos always use this shape.
  orientation: z.enum(["landscape", "portrait"]).default("landscape"),
  // Clockwise turn applied to the camera image, for a camera mounted sideways or upside down.
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  mirrorPreview: z.boolean().default(true),
});

export const printerSchema = z.object({
  enabled: z.boolean().default(false),
  printerName: z.string().trim().max(160).nullable().default(null),
  paperSize: z.enum(["4x6", "2x6", "5x7"]).default("4x6"),
  orientation: z.enum(["portrait", "landscape"]).default("portrait"),
});

export const DEFAULT_CAMERA = cameraSchema.parse({});
export const DEFAULT_PRINTER = printerSchema.parse({});

export const createBoothSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  notes: z.string().trim().max(500).optional(),
});

export const updateBoothSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  camera: cameraSchema.optional(),
  printer: printerSchema.optional(),
});

export const assignSchema = z.object({ boothId: z.string().uuid() });

export type CreateBooth = z.infer<typeof createBoothSchema>;
export type UpdateBooth = z.infer<typeof updateBoothSchema>;
export type Camera = z.infer<typeof cameraSchema>;
export type Printer = z.infer<typeof printerSchema>;
