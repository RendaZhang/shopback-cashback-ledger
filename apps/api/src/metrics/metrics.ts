import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

type MetricsGlobals = typeof globalThis & {
  __sb_registry?: Registry;
  __sb_http_requests_total?: Counter<'method' | 'route' | 'status'>;
  __sb_http_request_duration_seconds?: Histogram<'method' | 'route'>;
};

const g = globalThis as MetricsGlobals;

// singleton registry across tests/hot-reload
export const registry: Registry = g.__sb_registry ?? new Registry();
if (!g.__sb_registry) {
  collectDefaultMetrics({ register: registry });
  g.__sb_registry = registry;
}

// singleton metrics (avoid "already registered" in Jest)
export const httpRequestsTotal: Counter<'method' | 'route' | 'status'> =
  g.__sb_http_requests_total ??
  new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'],
    registers: [registry],
  });

export const httpRequestDurationSeconds: Histogram<'method' | 'route'> =
  g.__sb_http_request_duration_seconds ??
  new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [registry],
  });

g.__sb_http_requests_total = httpRequestsTotal;
g.__sb_http_request_duration_seconds = httpRequestDurationSeconds;
