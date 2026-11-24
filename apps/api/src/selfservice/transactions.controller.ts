import { Controller, Get, Header, Query, Req } from "@nestjs/common";
import { Allow } from "../auth/roles.js";
import { scope } from "../events/events.controller.js";
import type { Req as Request } from "../common/request.js";
import { transactionsSchema, TransactionsService, type TransactionsQuery } from "./transactions.service.js";

@Allow("EVENTS", "CASHIER")
@Controller("transactions")
export class TransactionsController {
  constructor(private readonly tx: TransactionsService) {}
  @Get() list(@Query({ schema: transactionsSchema }) q: TransactionsQuery, @Req() r: Request) { return this.tx.list(q, scope(r)); }

  @Get("export.csv")
  @Header("content-type", "text/csv; charset=utf-8") @Header("content-disposition", 'attachment; filename="pbooth-transactions.csv"') @Header("cache-control", "no-store")
  csv(@Query({ schema: transactionsSchema }) q: TransactionsQuery, @Req() r: Request) { return this.tx.csv(q, scope(r)); }
}
