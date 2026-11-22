import { z } from "zod";

export const pairSchema = z.object({
  boothCode: z.string().trim().toUpperCase().regex(/^PB-[0-9A-Z]{4}$/, "Not a booth code"),
  code: z.string().trim().min(8).max(20),
});

export const kioskHeartbeatSchema = z.object({
  lastError: z.string().max(500).nullable().optional(),
  camera: z.object({
    status: z.enum(["connected", "disconnected", "error", "unsupported", "permission-denied"]),
    name: z.string().max(160).optional(),
    resolution: z.string().max(20).optional(), // what the camera actually delivers, e.g. "1920x1080"
  }).optional(),
  cameras: z.array(z.object({ id: z.string().max(200), name: z.string().max(160) })).max(20).optional(),
  // The kiosk's offline queue (IndexedDB): what's still waiting to reach the cloud.
  queue: z.object({ pending: z.number().int().min(0), failed: z.number().int().min(0), lastSyncAt: z.string().datetime().nullable() }).optional(),
});

export type Pair = z.infer<typeof pairSchema>;
export type KioskHeartbeat = z.infer<typeof kioskHeartbeatSchema>;
