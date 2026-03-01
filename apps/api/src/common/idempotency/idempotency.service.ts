import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../db/prisma.service';

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  hashRequest(method: string, path: string, body: unknown) {
    const h = createHash('sha256');
    h.update(method.toUpperCase());
    h.update('|');
    h.update(path);
    h.update('|');
    h.update(JSON.stringify(body ?? null));
    return h.digest('hex');
  }

  async getCachedResponse(key: string, scope: string) {
    return this.prisma.idempotencyKey.findUnique({
      where: { key_scope: { key, scope } },
    });
  }

  async saveResponse(args: {
    key: string;
    scope: string;
    requestHash: string;
    responseBody: unknown;
    ttlSeconds?: number;
  }) {
    const expiresAt =
      args.ttlSeconds && args.ttlSeconds > 0
        ? new Date(Date.now() + args.ttlSeconds * 1000)
        : null;

    return this.prisma.idempotencyKey.upsert({
      where: { key_scope: { key: args.key, scope: args.scope } },
      update: {
        requestHash: args.requestHash,
        responseBody: args.responseBody as any,
        expiresAt,
      },
      create: {
        key: args.key,
        scope: args.scope,
        requestHash: args.requestHash,
        responseBody: args.responseBody as any,
        expiresAt,
      },
    });
  }
}
