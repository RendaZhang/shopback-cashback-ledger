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
import { MetricsThrottlerGuard } from './common/guards/metrics-throttler.guard';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 300,
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
      useClass: MetricsThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
