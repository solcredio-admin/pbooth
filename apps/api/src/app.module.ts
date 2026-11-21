import { type DynamicModule, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { CONFIG, type Config } from "./config.js";
import { PrismaService } from "./prisma.service.js";
import { AuditService } from "./audit/audit.service.js";
import { AuthService } from "./auth/auth.service.js";
import { AuthController } from "./auth/auth.controller.js";
import { AuthGuard } from "./auth/auth.guard.js";
import { EventsService } from "./events/events.service.js";
import { EventsController } from "./events/events.controller.js";
import { HealthController } from "./health/health.controller.js";
import { ErrorFilter } from "./common/error.filter.js";

// One module is plenty for Phase 1; split per feature when booths/photos arrive.
@Module({})
export class AppModule {
  static forRoot(cfg: Config): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, AuthController, EventsController],
      providers: [
        { provide: CONFIG, useValue: cfg },
        PrismaService, AuditService, AuthService, EventsService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: ErrorFilter },
      ],
    };
  }
}
