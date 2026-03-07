# Interview

## Resume bullets in Chinese & English

### 中文版本

**项目：ShopBack Cashback Ledger（个人作品）**

* 设计并实现 cashback 账本系统：契约先行（Swagger）+ 统一响应/错误码 + `Idempotency-Key`（scope + requestHash + response cache），解决客户端重试导致的重复写入与一致性问题。
* 基于 **Outbox Pattern + Redpanda(Kafka)** 搭建异步事件链路：确认订单事务内写 `OutboxEvent(OrderConfirmed)`，publisher 可靠投递；consumer 采用 **InboxEvent + 指数退避重试 + DLQ + Replay CLI**，并通过 `unique(orderId,type)` 实现 at-least-once 下的幂等入账。
* 完成工程化与可观测性闭环：CI 全绿、kind K8s 部署（rolling + canary）、Prometheus/Grafana dashboard + 告警 + SLO；k6 压测达 **~385 req/s、p95 ~21ms、0% 失败**，并通过 worker 宕机演练验证 **eventual consistency**（累计处理 **482** 条事件、0 failed）。

> 你可以把数字替换成你最想强调的：比如 “p95 20.84ms / 385 req/s”。

### English, 3 bullets, ShopBack-friendly

**Project: ShopBack Cashback Ledger (Personal Project)**

* Built a contract-first cashback ledger service with Swagger + standardized response/error model and **Idempotency-Key** (scope + requestHash + cached response) to make order writes safe under client/gateway retries.
* Implemented an event-driven pipeline using **Outbox Pattern + Redpanda (Kafka)**: confirmed orders write `OutboxEvent(OrderConfirmed)` in the same DB transaction; consumer uses **Inbox table + exponential backoff retries + DLQ + replay CLI** and enforces idempotent crediting via `unique(orderId,type)` for at-least-once delivery.
* Productionized the system with CI, **kind Kubernetes** (rolling + canary), and **Prometheus/Grafana** dashboards + alerts + SLO; achieved **~385 req/s, p95 ~21ms, 0% errors** in k6, and validated **eventual consistency** via worker-down fault drill (processed **482** events, 0 failed).

## Simplified Resume bullets

### 中文（2 条，最适合简历）

* 实现 ShopBack 风格 cashback 账本：Idempotency-Key（scope+hash+响应缓存）+ Outbox→Kafka + Inbox 重试/退避 + DLQ/Replay，结合 `unique(orderId,type)` 实现 at-least-once 下的幂等入账与一致性恢复。
* 完成工程化与可运营性：kind K8s（rolling/canary）+ Prometheus/Grafana + 告警 + SLO；k6 压测 **~385 req/s、p95 ~21ms、0% 失败**，并通过 worker 宕机演练验证 eventual consistency（backlog 自动消化）。

### English (2 bullets)

* Built a ShopBack-style cashback ledger with **Idempotency-Key** (scope+requestHash+cached response), **Outbox→Kafka**, and **Inbox retries with backoff + DLQ + replay**, enforcing idempotent crediting via `unique(orderId,type)` under at-least-once delivery.
* Productionized with **kind Kubernetes** (rolling/canary), **Prometheus/Grafana** dashboards + alerts + SLO; validated with k6 (**~385 req/s, p95 ~21ms, 0% errors**) and a worker-down fault drill demonstrating eventual consistency and backlog recovery.

## 30s Elevator Pitch

> Hi, I’m Renda. Recently I built a ShopBack-style cashback ledger system to demonstrate how I design reliable backend services. I started with a contract-first API and added Idempotency-Key so retries never create duplicated side effects. For async crediting, I used the Outbox pattern to atomically persist `OrderConfirmed` events with the order state, then published to Kafka. On the consumer side, I implemented an Inbox table with exponential backoff retries, DLQ, and a replay CLI, plus a unique ledger constraint to guarantee idempotent crediting under at-least-once delivery. I deployed everything on kind Kubernetes with rolling/canary, and wired Prometheus/Grafana dashboards, alerts, and an SLO. Under k6 load it sustained about 385 req/s with ~21ms p95 and zero errors.

## 10-Minute System Design Presentation Outline

1. **Problem & Constraints (1 min)**: Cashback confirmation with asynchronous posting; Retry/duplication/consistency/operability requirements

2. **API & Contract-First Approach (1 min)**: Swagger + envelope pattern + requestId; All write interfaces must be idempotent

3. **Data Model (1 min)**: Orders / Ledger / Rules / IdempotencyKey / Outbox / Inbox tables

4. **Idempotency Implementation (2 min)**: Key+scope+hash+cached response pattern; 409 Conflict handling; Database unique constraint as secondary safeguard

5. **Outbox Pattern (2 min)**: Writing to outbox within the same transaction; Publisher retry mechanism; Avoiding dual-write inconsistency

6. **Consumer & Inbox Retry Strategy (2 min)**: At-least-once delivery guarantee; Inbox deduplication; Exponential backoff; Dead Letter Queue (DLQ); Message replay capability

7. **Operations & Validation (1 min)**: K8s rolling/canary deployments; Grafana monitoring/alerts/SLOs; Load testing data; Worker failure simulation and backlog positioning explanation (your observation here is particularly valuable)

## Quick Tips (Making This Experience More "Resume-Project-Like")

* Add a technology stack line next to the project title: `Tech: NestJS, Prisma/Postgres, Redis, Redpanda(Kafka), Prometheus/Grafana, Kubernetes(kind), k6`
* Include screenshots of the "Load testing" and "Fault drill" sections from the repo README (dashboard + backlog charts) - interviewers will instantly recognize the credibility

These small additions will make your project experience stand out and demonstrate concrete technical implementation with proper monitoring and testing practices.

