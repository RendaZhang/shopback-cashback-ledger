import { Injectable } from '@nestjs/common';
import { Prisma } from '@sb/db';
import { getRedis } from '../cache/redis.client';
import { PrismaService } from '../db/prisma.service';

export type CashbackRuleSnapshot = {
  rate: string;
  cap: string | null;
};

@Injectable()
export class CashbackRuleService {
  private readonly redis = getRedis();
  private readonly cacheTtlSeconds = Number(process.env.CASHBACK_RULE_CACHE_TTL_SECONDS ?? '60');
  private readonly lockTtlMs = Number(process.env.CASHBACK_RULE_CACHE_LOCK_MS ?? '300');
  private readonly lockWaitMs = Number(process.env.CASHBACK_RULE_CACHE_WAIT_MS ?? '30');

  constructor(private readonly prisma: PrismaService) {}

  private key(merchantId: string): string {
    return `cashback_rule:${merchantId}`;
  }

  private parseCached(raw: string): CashbackRuleSnapshot | null {
    try {
      const parsed = JSON.parse(raw) as Partial<CashbackRuleSnapshot>;
      if (typeof parsed.rate !== 'string') return null;
      if (parsed.cap !== null && typeof parsed.cap !== 'string' && parsed.cap !== undefined) return null;
      return {
        rate: parsed.rate,
        cap: parsed.cap ?? null,
      };
    } catch {
      return null;
    }
  }

  async getRule(merchantId: string): Promise<CashbackRuleSnapshot> {
    const cacheKey = this.key(merchantId);
    const cached = await this.readCache(cacheKey);
    if (cached) return cached;

    const lockKey = `${cacheKey}:lock`;
    const gotLock = await this.acquireLock(lockKey);

    try {
      if (!gotLock) {
        await new Promise((resolve) => setTimeout(resolve, this.lockWaitMs));
        const retried = await this.readCache(cacheKey);
        if (retried) return retried;
      }

      const fromDb = await this.prisma.cashbackRule.findUnique({ where: { merchantId } });
      const payload: CashbackRuleSnapshot = {
        rate: (fromDb?.rate ?? new Prisma.Decimal('0.05')).toString(),
        cap: fromDb?.cap ? fromDb.cap.toString() : null,
      };

      await this.writeCache(cacheKey, payload);
      return payload;
    } finally {
      if (gotLock) await this.releaseLock(lockKey);
    }
  }

  async invalidate(merchantId: string): Promise<void> {
    const cacheKey = this.key(merchantId);
    try {
      await this.redis.del(cacheKey);
    } catch (error) {
      console.error('[cache] failed to invalidate cashback rule', { merchantId, error: String(error) });
    }
  }

  private async readCache(cacheKey: string): Promise<CashbackRuleSnapshot | null> {
    try {
      const raw = await this.redis.get(cacheKey);
      if (!raw) return null;
      return this.parseCached(raw);
    } catch (error) {
      console.error('[cache] failed to read cashback rule cache', { cacheKey, error: String(error) });
      return null;
    }
  }

  private async writeCache(cacheKey: string, payload: CashbackRuleSnapshot): Promise<void> {
    try {
      await this.redis.set(cacheKey, JSON.stringify(payload), 'EX', this.cacheTtlSeconds);
    } catch (error) {
      console.error('[cache] failed to write cashback rule cache', { cacheKey, error: String(error) });
    }
  }

  private async acquireLock(lockKey: string): Promise<boolean> {
    try {
      const lockResult = await this.redis.set(lockKey, '1', 'PX', this.lockTtlMs, 'NX');
      return lockResult === 'OK';
    } catch (error) {
      console.error('[cache] failed to acquire cashback rule lock', { lockKey, error: String(error) });
      return false;
    }
  }

  private async releaseLock(lockKey: string): Promise<void> {
    try {
      await this.redis.del(lockKey);
    } catch (error) {
      console.error('[cache] failed to release cashback rule lock', { lockKey, error: String(error) });
    }
  }
}
