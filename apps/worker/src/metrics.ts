import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

type WorkerMetricsGlobals = typeof globalThis & {
  __sb_worker_registry?: Registry;
  __sb_inbox_pending?: Gauge;
  __sb_inbox_failed?: Gauge;
  __sb_outbox_pending?: Gauge;
  __sb_dlq_produced_total?: Counter;
  __sb_inbox_retries_total?: Counter;
  __sb_cashback_rule_cache_hits_total?: Counter;
  __sb_cashback_rule_cache_misses_total?: Counter;
  __sb_order_confirmed_handler_duration_seconds?: Histogram<'outcome'>;
};

const g = globalThis as WorkerMetricsGlobals;

export const registry: Registry = g.__sb_worker_registry ?? new Registry();
if (!g.__sb_worker_registry) {
  collectDefaultMetrics({ register: registry });
  g.__sb_worker_registry = registry;
}

export const inboxPendingGauge: Gauge =
  g.__sb_inbox_pending ??
  new Gauge({
    name: 'worker_inbox_pending',
    help: 'Number of inbox events pending for processing',
    registers: [registry],
  });

export const inboxFailedGauge: Gauge =
  g.__sb_inbox_failed ??
  new Gauge({
    name: 'worker_inbox_failed',
    help: 'Number of inbox events failed (exceeded max attempts)',
    registers: [registry],
  });

export const outboxPendingGauge: Gauge =
  g.__sb_outbox_pending ??
  new Gauge({
    name: 'worker_outbox_pending',
    help: 'Number of outbox events pending to publish',
    registers: [registry],
  });

export const dlqProducedTotal: Counter =
  g.__sb_dlq_produced_total ??
  new Counter({
    name: 'worker_dlq_produced_total',
    help: 'Total messages produced to DLQ',
    registers: [registry],
  });

export const inboxRetriesTotal: Counter =
  g.__sb_inbox_retries_total ??
  new Counter({
    name: 'worker_inbox_retries_total',
    help: 'Total retry attempts executed by retry loop',
    registers: [registry],
  });

export const cashbackRuleCacheHitsTotal: Counter =
  g.__sb_cashback_rule_cache_hits_total ??
  new Counter({
    name: 'worker_cashback_rule_cache_hits_total',
    help: 'Total cashback rule cache hits in worker processing path',
    registers: [registry],
  });

export const cashbackRuleCacheMissesTotal: Counter =
  g.__sb_cashback_rule_cache_misses_total ??
  new Counter({
    name: 'worker_cashback_rule_cache_misses_total',
    help: 'Total cashback rule cache misses in worker processing path',
    registers: [registry],
  });

export const orderConfirmedHandlerDurationSeconds: Histogram<'outcome'> =
  g.__sb_order_confirmed_handler_duration_seconds ??
  new Histogram({
    name: 'worker_order_confirmed_handler_duration_seconds',
    help: 'OrderConfirmed handler execution time in seconds',
    labelNames: ['outcome'],
    buckets: [0.001, 0.003, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [registry],
  });

g.__sb_inbox_pending = inboxPendingGauge;
g.__sb_inbox_failed = inboxFailedGauge;
g.__sb_outbox_pending = outboxPendingGauge;
g.__sb_dlq_produced_total = dlqProducedTotal;
g.__sb_inbox_retries_total = inboxRetriesTotal;
g.__sb_cashback_rule_cache_hits_total = cashbackRuleCacheHitsTotal;
g.__sb_cashback_rule_cache_misses_total = cashbackRuleCacheMissesTotal;
g.__sb_order_confirmed_handler_duration_seconds = orderConfirmedHandlerDurationSeconds;
