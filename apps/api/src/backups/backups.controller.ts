import { Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import { BackupsService } from "./backups.service.js";
import type { Req as Request } from "../common/request.js";

@Controller("backups")
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get()
  list() { return this.backups.list(); }

  @Post() @HttpCode(200)
  create(@Req() r: Request) { return this.backups.run(`admin:${r.admin!.id}`); }
}
