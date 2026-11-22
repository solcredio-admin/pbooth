import { z } from "zod";

const status = z.object({ status: z.enum(["connected", "disconnected", "error", "unsupported"]), name: z.string().max(160).optional() });

export const enrollSchema = z.object({
  code: z.string().trim().min(8).max(20),
  device: z.object({
    identifier: z.string().trim().min(1).max(200),
    hostname: z.string().trim().max(120).optional(),
    os: z.string().trim().max(80).optional(),
    agentVersion: z.string().trim().max(40).optional(),
  }),
  simulated: z.boolean().default(false),
});

export const heartbeatSchema = z.object({
  agentVersion: z.string().max(40).optional(),
  os: z.string().max(80).optional(),
  hostname: z.string().max(120).optional(),
  configVersion: z.string().max(64).optional(),
  lastError: z.string().max(500).nullable().optional(),
  storage: z.object({ freeBytes: z.number().int().min(0), totalBytes: z.number().int().min(0) }).optional(),
  pendingUploads: z.number().int().min(0).max(1_000_000).default(0),
  pendingPrints: z.number().int().min(0).max(1_000_000).default(0),
  camera: status.extend({ compatibility: z.enum(["tested", "untested", "unsupported", "simulated"]).optional(), model: z.string().max(160).optional() }).optional(),
  printer: status.optional(),
  printJobs: z.object({ queued: z.number().int().min(0), failed: z.number().int().min(0), completedToday: z.number().int().min(0) }).optional(),
  // What the booth computer actually found; the admin picks from these.
  cameras: z.array(z.object({ id: z.string().max(200), name: z.string().max(160), provider: z.enum(["webcam", "gphoto2"]) })).max(20).optional(),
  printers: z.array(z.object({ name: z.string().max(160), isDefault: z.boolean().optional() })).max(20).optional(),
});

export const ackSchema = z.object({ version: z.string().min(1).max(64) });

export type Enroll = z.infer<typeof enrollSchema>;
export type Heartbeat = z.infer<typeof heartbeatSchema>;
