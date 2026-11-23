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
import { KioskService } from "./kiosk/kiosk.service.js";
import { KioskController } from "./kiosk/kiosk.controller.js";
import { KioskGuard } from "./kiosk/kiosk.guard.js";
import { SessionsService } from "./sessions/sessions.service.js";
import { SessionsController } from "./sessions/sessions.controller.js";
import { StorageService } from "./storage/storage.service.js";
import { PhotosService } from "./photos/photos.service.js";
import { PhotosController, EventPhotosController, StorageController } from "./photos/photos.controller.js";
import { BoothAuthGuard } from "./photos/booth-auth.guard.js";
import { GalleriesService } from "./galleries/galleries.service.js";
import { GalleriesController } from "./galleries/galleries.controller.js";

import { BackupsController } from "./backups/backups.controller.js";
import { UsersController } from "./users/users.controller.js";
import { SelfServiceController } from "./selfservice/selfservice.controller.js";
import { SelfServiceService } from "./selfservice/selfservice.service.js";
import { UsersService } from "./users/users.service.js";
import { BackupsService } from "./backups/backups.service.js";

// One module keeps wiring in one place; split per feature if it grows past easy reading.
@Module({})
export class AppModule {
  static forRoot(cfg: Config): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, AuthController, EventsController, BoothsController, EventBoothsController, DevicesController, KioskController, SessionsController, PhotosController, EventPhotosController, StorageController, GalleriesController, BackupsController, UsersController, SelfServiceController],
      providers: [
        { provide: CONFIG, useValue: cfg },
        PrismaService, AuditService, AuthService, EventsService, BoothsService, DevicesService, DeviceGuard, RealtimeGateway, KioskService, KioskGuard, SessionsService, StorageService, PhotosService, BoothAuthGuard, GalleriesService, BackupsService, UsersService, SelfServiceService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: ErrorFilter },
      ],
    };
  }
}
