# Load Test Baseline (k6)

## Scenario

- create order + confirm order
- stages: 20s@20 VUs -> 40s@50 VUs -> 20s ramp down
- run date: 2026-03-06
- run mode: Docker k6 (`--network host`) against `http://localhost:30080`

## k6 result (paste)

```text
THRESHOLDS
http_req_duration: p(95)=22.25ms (threshold p(95)<300) PASS
http_req_failed: rate=0.00% (threshold rate<0.01) PASS

HTTP
http_req_duration: avg=11.58ms med=10.13ms p(90)=19.24ms p(95)=22.25ms max=2.78s
http_req_failed: 0.00% (0 out of 33836)
http_reqs: 33836 (381.720445/s)

EXECUTION
iterations: 16918 (190.860222/s)
vus: max=49
vus_max: 50
```

## Observations

- p95 latency: **22.25ms** (well below 300ms baseline threshold)
- error rate: **0.00%**
- throughput:
  - request rate (`http_reqs`): **381.72 req/s**
  - iteration rate (`iterations`): **190.86 iter/s**
- bottlenecks hypothesis:
  - DB connection / transaction time
  - Prisma query latency
  - Kafka/worker lag (async path)
- notes:
  - k6 emitted a high-cardinality warning due many unique URL time series; future script optimization can add stable request `name` tags to reduce cardinality noise.

## Optimized Run (After Rate Limit + Cashback Rule Cache)

- run date: 2026-03-06
- run mode: Docker k6 (`--network host`, `--quiet`) against `http://localhost:30080`
- app changes before run:
  - global throttling enabled (`ttl=60_000ms`, `limit=300` per pod)
  - cashback rule cache enabled (Redis + TTL + lock)

### k6 result

```text
THRESHOLDS
http_req_duration: p(95)=7.8ms (threshold p(95)<300) PASS
http_req_failed: rate=92.30% (threshold rate<0.01) FAIL

HTTP
http_req_duration: avg=2.96ms med=1.2ms p(95)=7.8ms max=2.94s
http_req_failed: 92.30% (19550 out of 21180)
http_reqs: 21180 (255.323498/s)

EXECUTION
iterations: 20280 (244.474057/s)
```

### Interpretation

- This run is intentionally in a **protected** profile:
  - k6 stage load exceeds the configured global throttle budget, so a large portion of requests are rejected as `429`.
- Latency still remains low for accepted requests; failure-rate threshold now reflects protection behavior, not API correctness regression.
- To compare pure service capacity with the original baseline, temporarily raise throttle limits or use a lower-VU test profile.

## User-Based Throttle Run (Final)

- run date: 2026-03-06
- run mode: Docker k6 (`--network host`, `--quiet`) against `http://localhost:30080`
- app changes before run:
  - throttler tracker: `X-User-Id` first, fallback to IP
  - throttle config from env: `THROTTLE_TTL=60s`, `THROTTLE_LIMIT=600`
  - k6 create/confirm requests now include `X-User-Id: u_<VU>`

### k6 result

```text
THRESHOLDS
http_req_duration: p(95)=20.84ms (threshold p(95)<300) PASS
http_req_failed: rate=0.00% (threshold rate<0.01) PASS

HTTP
http_req_duration: avg=11.66ms med=10.28ms p(95)=20.84ms max=2.63s
http_req_failed: 0.00% (0 out of 33920)
http_reqs: 33920 (385.052687/s)

EXECUTION
iterations: 16960 (192.526344/s)
```

### Prometheus verification

- query: `sum(rate(http_requests_total{status="429"}[1m]))`
- observed after run: `429_rate=0`

### Interpretation

- User-based throttling preserves abuse protection while avoiding cross-user contention during mixed-user load tests.
- This matches real traffic assumptions better than pure IP-based throttling behind shared gateways.
