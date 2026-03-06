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
