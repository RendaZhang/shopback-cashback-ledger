import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AppModule } from './app.module';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { HttpExceptionToApiResponseFilter } from './common/filters/http-exception.filter';
import { runMigrationsIfEnabled } from './db/run-migrations';
import { MetricsInterceptor } from './metrics/metrics.interceptor';
import { registry } from './metrics/metrics';

async function bootstrap() {
  await runMigrationsIfEnabled();
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalInterceptors(new MetricsInterceptor());

  // Prometheus metrics (bypass response envelope)
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.get('/metrics', async (_req: Request, res: Response) => {
    res.setHeader('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  });

  app.useGlobalFilters(new HttpExceptionToApiResponseFilter());

  const config = new DocumentBuilder()
    .setTitle('ShopBack Cashback Ledger (Interview Demo)')
    .setDescription('Contract-first API skeleton with requestId + unified response')
    .setVersion('0.1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(3000);
}
bootstrap();
