import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaService } from './db/prisma.service';
import { IdempotencyService } from './common/idempotency/idempotency.service';
import { OrdersController } from './orders/orders.controller';
import { UsersController } from './users/users.controller';
import { HealthController } from './health/health.controller';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { ConfigController } from './config/config.controller';
import { MerchantsController } from './merchants/merchants.controller';
import { CashbackRuleService } from './merchants/cashback-rule.service';
import { UserThrottlerGuard } from './common/throttle/user-throttler.guard';

function getPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? '');
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

const throttleTtlSeconds = getPositiveInt(process.env.THROTTLE_TTL, 60);
const throttleLimit = getPositiveInt(process.env.THROTTLE_LIMIT, 600);

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        // @nestjs/throttler v6 uses milliseconds for ttl
        ttl: throttleTtlSeconds * 1000,
        limit: throttleLimit,
      },
    ]),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),
  ],
  controllers: [OrdersController, UsersController, HealthController, ConfigController, MerchantsController],
  providers: [
    PrismaService,
    IdempotencyService,
    CashbackRuleService,
    {
      provide: APP_GUARD,
      useClass: UserThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
