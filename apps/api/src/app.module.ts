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
import { BoothsService } from "./booths/booths.service.js";
import { BoothsController, EventBoothsController } from "./booths/booths.controller.js";
import { DevicesService } from "./devices/devices.service.js";
import { DevicesController } from "./devices/devices.controller.js";
import { DeviceGuard } from "./devices/device.guard.js";
import { RealtimeGateway } from "./realtime/realtime.gateway.js";

// One module keeps wiring in one place; split per feature if it grows past easy reading.
@Module({})
export class AppModule {
  static forRoot(cfg: Config): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, AuthController, EventsController, BoothsController, EventBoothsController, DevicesController],
      providers: [
        { provide: CONFIG, useValue: cfg },
        PrismaService, AuditService, AuthService, EventsService, BoothsService, DevicesService, DeviceGuard, RealtimeGateway,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: ErrorFilter },
      ],
    };
  }
}
