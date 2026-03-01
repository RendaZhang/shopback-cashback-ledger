export type AppConfig = {
  port: number;
  serviceName: string;
  postgres: {
    host: string;
    port: number;
    db: string;
    user: string;
    password: string;
  };
  redis: {
    host: string;
    port: number;
  };
  kafka: {
    broker: string;
  };
};

function mustGet(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') throw new Error(`Missing env: ${name}`);
  return v.trim();
}

function getInt(name: string, fallback?: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') {
    if (fallback === undefined) throw new Error(`Missing env: ${name}`);
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid int env: ${name}=${raw}`);
  return n;
}

export function loadConfig(): AppConfig {
  return {
    port: getInt('PORT', 3000),
    serviceName: process.env.SERVICE_NAME?.trim() || 'sb-ledger-api',
    postgres: {
      host: mustGet('POSTGRES_HOST'),
      port: getInt('POSTGRES_PORT', 5432),
      db: mustGet('POSTGRES_DB'),
      user: mustGet('POSTGRES_USER'),
      password: mustGet('POSTGRES_PASSWORD'),
    },
    redis: {
      host: mustGet('REDIS_HOST'),
      port: getInt('REDIS_PORT', 6379),
    },
    kafka: {
      broker: mustGet('KAFKA_BROKER'),
    },
  };
}
