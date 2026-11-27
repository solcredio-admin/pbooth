import { Controller, Get, Header, Query } from "@nestjs/common";
import { z } from "zod";
import { AUDIT_KINDS, AuditService, type AuditKind } from "./audit.service.js";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  actor: z.string().max(60).optional(),
  kind: z.enum(Object.keys(AUDIT_KINDS) as [AuditKind, ...AuditKind[]]).optional(),
  entity: z.string().max(80).optional(),
  from: day, to: day,
  guests: z.enum(["1", "0"]).optional().transform((v) => v === "1"),
});

// Owner only (no @Allow). Read-only: nothing in the app edits or deletes entries.
@Controller("audit")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query({ schema: querySchema }) q: z.infer<typeof querySchema>) { return this.audit.list(q); }

  @Get("csv")
  @Header("content-type", "text/csv; charset=utf-8")
  @Header("content-disposition", 'attachment; filename="pbooth-audit-log.csv"')
  csv(@Query({ schema: querySchema }) q: z.infer<typeof querySchema>) { return this.audit.csv(q); }
}
