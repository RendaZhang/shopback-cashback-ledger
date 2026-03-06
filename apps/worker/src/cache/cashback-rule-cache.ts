import { Prisma } from '@sb/db';
import { getRedis } from './redis.client';

type DbRule = { rate: Prisma.Decimal; cap: Prisma.Decimal | null } | null;

type CashbackRuleReader = {
  cashbackRule: {
    findUnique(args: { where: { merchantId: string } }): Promise<DbRule>;
  };
};

type CachedCashbackRule = {
  rate: string;
  cap: string | null;
};

const cacheTtlSeconds = Number(process.env.CASHBACK_RULE_CACHE_TTL_SECONDS ?? '60');
const lockTtlMs = Number(process.env.CASHBACK_RULE_CACHE_LOCK_MS ?? '300');
const lockWaitMs = Number(process.env.CASHBACK_RULE_CACHE_WAIT_MS ?? '30');

function key(merchantId: string): string {
  return `cashback_rule:${merchantId}`;
}

function toDecimalRule(rule: CachedCashbackRule): { rate: Prisma.Decimal; cap: Prisma.Decimal | null } {
  return {
    rate: new Prisma.Decimal(rule.rate),
    cap: rule.cap ? new Prisma.Decimal(rule.cap) : null,
  };
}

function parseCached(raw: string): CachedCashbackRule | null {
  try {
    const parsed = JSON.parse(raw) as Partial<CachedCashbackRule>;
    if (typeof parsed.rate !== 'string') return null;
    if (parsed.cap !== null && typeof parsed.cap !== 'string' && parsed.cap !== undefined) return null;
    return { rate: parsed.rate, cap: parsed.cap ?? null };
  } catch {
    return null;
  }
}

export async function getCashbackRule(
  reader: CashbackRuleReader,
  merchantId: string,
): Promise<{ rate: Prisma.Decimal; cap: Prisma.Decimal | null }> {
  const redis = getRedis();
  const cacheKey = key(merchantId);

  const cached = await readCache(redis, cacheKey);
  if (cached) return toDecimalRule(cached);

  const lockKey = `${cacheKey}:lock`;
  const gotLock = await acquireLock(redis, lockKey);

  try {
    if (!gotLock) {
      await new Promise((resolve) => setTimeout(resolve, lockWaitMs));
      const retried = await readCache(redis, cacheKey);
      if (retried) return toDecimalRule(retried);
    }

    const rule = await reader.cashbackRule.findUnique({ where: { merchantId } });
    const payload: CachedCashbackRule = {
      rate: (rule?.rate ?? new Prisma.Decimal('0.05')).toString(),
      cap: rule?.cap ? rule.cap.toString() : null,
    };

    await writeCache(redis, cacheKey, payload);
    return toDecimalRule(payload);
  } finally {
    if (gotLock) await releaseLock(redis, lockKey);
  }
}

async function readCache(redis: ReturnType<typeof getRedis>, cacheKey: string): Promise<CachedCashbackRule | null> {
  try {
    const raw = await redis.get(cacheKey);
    if (!raw) return null;
    return parseCached(raw);
  } catch (error) {
    console.error('[cache] failed to read cashback rule cache', { cacheKey, error: String(error) });
    return null;
  }
}

async function writeCache(
  redis: ReturnType<typeof getRedis>,
  cacheKey: string,
  payload: CachedCashbackRule,
): Promise<void> {
  try {
    await redis.set(cacheKey, JSON.stringify(payload), 'EX', cacheTtlSeconds);
  } catch (error) {
    console.error('[cache] failed to write cashback rule cache', { cacheKey, error: String(error) });
  }
}

async function acquireLock(redis: ReturnType<typeof getRedis>, lockKey: string): Promise<boolean> {
  try {
    const lockResult = await redis.set(lockKey, '1', 'PX', lockTtlMs, 'NX');
    return lockResult === 'OK';
  } catch (error) {
    console.error('[cache] failed to acquire cashback rule lock', { lockKey, error: String(error) });
    return false;
  }
}

async function releaseLock(redis: ReturnType<typeof getRedis>, lockKey: string): Promise<void> {
  try {
    await redis.del(lockKey);
  } catch (error) {
    console.error('[cache] failed to release cashback rule lock', { lockKey, error: String(error) });
  }
}
