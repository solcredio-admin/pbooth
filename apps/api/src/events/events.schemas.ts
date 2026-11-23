import { z } from "zod";
import { isValidTimeZone } from "./tz.js";

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).transform((v) => v || null).nullish();
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a #rrggbb colour");

export const configSchema = z.object({
  welcomeTitle: text(80).min(1),
  welcomeMessage: text(200),
  primaryColor: hex,
  accentColor: hex,
  countdownSeconds: z.number().int().min(0).max(10),
  shotsPerSession: z.number().int().min(1).max(4),
  captureIntervalSeconds: z.number().int().min(1).max(10),
  layout: z.enum(["landscape", "strip", "grid"]),
  pattern: z.enum(["none", "dots", "stripes", "grid", "confetti", "waves", "gradient"]),
  frameStyle: z.enum(["line", "double", "corners", "none"]),
  photoStyle: z.enum(["rounded", "square", "white"]),
  fontStyle: z.enum(["serif", "sans", "mono"]),
  footerText: text(60),
  showDate: z.boolean(),
  printEnabled: z.boolean(),
  printCopies: z.number().int().min(1).max(5),
  galleryEnabled: z.boolean(),
  galleryRetentionDays: z.number().int().min(1).max(365),
  saveOriginals: z.boolean(),
}).partial();

const when = {
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM"),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM"),
  timeZone: z.string().refine(isValidTimeZone, "Unknown time zone"),
};

const fields = {
  name: text(120).min(1, "Name is required"),
  organizerName: optionalText(120),
  contactPhone: text(40).regex(/^[0-9+()\-.\s]*(ext\.?\s*\d+)?$/i, "Digits, spaces and + ( ) - only").transform((v) => v || null).nullish(),
  contactEmail: text(254).transform((v) => v || null).pipe(z.string().email("Not a valid email").nullable()).nullish(),
  venueName: optionalText(160),
  venueAddress: optionalText(300),
  config: configSchema.optional(),
  // self-service (a booth left at a café): price per paid session, free mode, revenue share
  kind: z.enum(["MANAGED", "SELF_SERVICE"]).optional(),
  priceCentavos: z.number().int().min(0).max(10_000_000).optional(),
  freeSessions: z.boolean().optional(),
  partnerName: optionalText(120),
  partnerSharePercent: z.number().int().min(0).max(100).nullish(),
};

export const createEventSchema = z.object({ ...fields, ...when });

// Times can only change together: a date without its zone (or vice versa) is ambiguous.
export const updateEventSchema = z.object({
  ...z.object(fields).partial().shape,
  ...z.object(when).partial().shape,
}).refine((b) => {
  const n = [b.date, b.startTime, b.endTime, b.timeZone].filter((v) => v !== undefined).length;
  return n === 0 || n === 4;
}, { message: "date, startTime, endTime and timeZone must be sent together", path: ["date"] });

export const listEventsSchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(["DRAFT", "SCHEDULED", "ACTIVE", "COMPLETED", "ARCHIVED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export type CreateEvent = z.infer<typeof createEventSchema>;
export type UpdateEvent = z.infer<typeof updateEventSchema>;
export type ListEvents = z.infer<typeof listEventsSchema>;
