import { z } from "zod";

const settings = {
  name: z.string().trim().min(1, "Name is required").max(80),
  enabled: z.boolean(),
  printerName: z.string().trim().max(160).nullable(),
  paperSize: z.enum(["4x6", "2x6", "5x7"]),
  orientation: z.enum(["portrait", "landscape"]),
};
export const createStationSchema = z.object({ name: settings.name });
export const updateStationSchema = z.object(settings).partial();
export const boothStationsSchema = z.object({ stationIds: z.array(z.string().uuid()).max(20).refine((a) => new Set(a).size === a.length, "A station is listed twice"), mode: z.enum(["FIXED", "ROTATE"]).optional() });
export const moveSchema = z.object({ stationId: z.string().uuid(), confirm: z.boolean().default(false) });

export const pollSchema = z.object({
  ready: z.boolean(),
  error: z.string().max(500).nullable().default(null),
  printers: z.array(z.object({ name: z.string().max(160), isDefault: z.boolean().optional() })).max(40).default([]),
  agentVersion: z.string().max(40).optional(),
  os: z.string().max(80).optional(),
  hostname: z.string().max(120).optional(),
});
export const reportSchema = z.object({ attempt: z.number().int().min(1), status: z.enum(["PRINTING", "DONE", "FAILED"]), error: z.string().max(500).nullable().default(null),
  safe: z.boolean().default(false), // FAILED, and nothing can have come out of the printer
});

/** From the kiosk: print this session's finished design (already uploaded). */
export const printSchema = z.object({ sessionId: z.string().uuid(), photoId: z.string().uuid(), strip: z.boolean().default(false) });

export type UpdateStation = z.infer<typeof updateStationSchema>;
export type Poll = z.infer<typeof pollSchema>;
export type Report = z.infer<typeof reportSchema>;
export type PrintRequest = z.infer<typeof printSchema>;
