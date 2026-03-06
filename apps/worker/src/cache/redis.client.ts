import Redis from 'ioredis';

const g = globalThis as { __sb_worker_redis?: Redis };

export function getRedis(): Redis {
  if (g.__sb_worker_redis) return g.__sb_worker_redis;

  const host = process.env.REDIS_HOST ?? 'localhost';
  const port = Number(process.env.REDIS_PORT ?? '6379');
  const redis = new Redis({ host, port, lazyConnect: false });
  g.__sb_worker_redis = redis;
  return redis;
}
