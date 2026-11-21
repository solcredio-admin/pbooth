import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { CONFIG, type Config } from "./config.js";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(CONFIG) cfg: Config) {
    super({ adapter: new PrismaPg({ connectionString: cfg.DATABASE_URL }) });
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
