import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { loadConfig } from './app.config';

@ApiTags('config')
@Controller('config')
export class ConfigController {
  @Get()
  @ApiOperation({ summary: 'Config self-check (dev only)' })
  getConfig() {
    const cfg = loadConfig();
    return {
      port: cfg.port,
      serviceName: cfg.serviceName,
      postgres: { host: cfg.postgres.host, port: cfg.postgres.port, db: cfg.postgres.db, user: cfg.postgres.user },
      redis: cfg.redis,
      kafka: cfg.kafka,
    };
  }
}
