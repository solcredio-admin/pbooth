import { Controller, Get, HttpStatus } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import { Public } from "../auth/public.decorator.js";
import { ApiError } from "../common/errors.js";

@Controller("health")
export class HealthController {
  constructor(private readonly db: PrismaService) {}

  @Public()
  @Get()
  async health() {
    try {
      await this.db.$queryRaw`SELECT 1`;
    } catch {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, "DB_UNAVAILABLE", "Database is not reachable");
    }
    return { status: "ok" };
  }
}
