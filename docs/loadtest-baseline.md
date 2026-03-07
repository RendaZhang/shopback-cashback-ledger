# Load Test Baseline Registry (k6)

This file records load-test runs in a structured, append-only format for long-term comparison.

**Owner:** Platform Engineering (Demo)  
**Last Updated:** 2026-03-07  
**Applies To:** k6 script `infra/loadtest/k6-create-confirm.js` against local/kind environments

## 1. Scenario Definition

- workload: create order + confirm order
- script: `infra/loadtest/k6-create-confirm.js`
- stages: `20s@20 VUs -> 40s@50 VUs -> 20s@0`
- default thresholds:
  - `http_req_failed: rate<0.01`
  - `http_req_duration: p(95)<300`

## 2. Run Summary Table

| Run ID | Date | Change Set | Throttle Strategy | p95 Latency | Error Rate | Request Rate | Iteration Rate | Threshold Result |
|---|---|---|---|---:|---:|---:|---:|---|
| LT-001 | 2026-03-06 | Baseline before Redis cache | N/A | 22.25ms | 0.00% | 381.72 req/s | 190.86 iter/s | PASS |
| LT-002 | 2026-03-06 | Redis cache + IP-based throttle | IP, 300/60s per pod | 7.8ms | 92.30% | 255.32 req/s | 244.47 iter/s | FAIL (`http_req_failed`) |
| LT-003 | 2026-03-06 | Redis cache + user throttler guard | `X-User-Id` first, fallback IP, 600/60s | 20.84ms | 0.00% | 385.05 req/s | 192.53 iter/s | PASS |

## 3. Detailed Runs

### LT-001

#### Metadata

- date: 2026-03-06
- environment: kind (`localhost:30080`)
- command:

```bash
docker run --rm --network host -i grafana/k6 run -e BASE_URL=http://localhost:30080 - < infra/loadtest/k6-create-confirm.js
```

#### Key Metrics

```text
http_req_duration: p(95)=22.25ms
http_req_failed: rate=0.00%
http_reqs: 33836 (381.720445/s)
iterations: 16918 (190.860222/s)
```

#### Notes

- This run represents baseline before Redis cashback-rule cache optimization.

### LT-002

#### Metadata

- date: 2026-03-06
- environment: kind (`localhost:30080`)
- command:

```bash
docker run --rm --network host -i grafana/k6 run --quiet -e BASE_URL=http://localhost:30080 - < infra/loadtest/k6-create-confirm.js
```

#### Key Metrics

```text
http_req_duration: p(95)=7.8ms
http_req_failed: rate=92.30%
http_reqs: 21180 (255.323498/s)
iterations: 20280 (244.474057/s)
```

#### Notes

- Redis cache was enabled, but throttling was IP-based and strict (`300/60s per pod`).
- This intentionally produced a high 429 ratio under burst profile.

### LT-003

#### Metadata

- date: 2026-03-06
- environment: kind (`localhost:30080`)
- command:

```bash
docker run --rm --network host -i grafana/k6 run --quiet -e BASE_URL=http://localhost:30080 - < infra/loadtest/k6-create-confirm.js
```

#### Key Metrics

```text
http_req_duration: p(95)=20.84ms
http_req_failed: rate=0.00%
http_reqs: 33920 (385.052687/s)
iterations: 16960 (192.526344/s)
```

#### Prometheus Validation

- query:

```promql
sum(rate(http_requests_total{status="429"}[1m]))
```

- observed: `0`

#### Notes

- k6 requests include `X-User-Id: u_<VU>`.
- User-based throttling prevents cross-user contention and keeps error rate low for mixed-user traffic.

## Template for Future Runs

When adding a new run:

1. Add one row to the summary table.
2. Add one detailed section following this template.

````md
### LT-00X
#### Metadata
- date:
- environment:
- command:
#### Key Metrics
```text
http_req_duration: p(95)=
http_req_failed: rate=
http_reqs:
iterations:
```
#### Prometheus Validation (optional)
- query:
- observed:
#### Notes
- change set:
- interpretation:
````
