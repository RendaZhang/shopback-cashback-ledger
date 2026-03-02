import 'dotenv/config';
import { PrismaClient, OutboxStatus } from '@prisma/client';
import { Kafka } from 'kafkajs';
import { startConsumer } from './consumer';
import { retryInboxLoop } from './inbox-retry';

const prisma = new PrismaClient();

const broker = process.env.KAFKA_BROKER ?? 'localhost:9092';
const topic = process.env.OUTBOX_TOPIC ?? 'order.events';
const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS ?? '1000');
const batchSize = Number(process.env.BATCH_SIZE ?? '50');
const maxAttempts = Number(process.env.MAX_ATTEMPTS ?? '5');

const kafka = new Kafka({
  clientId: process.env.SERVICE_NAME ?? 'sb-ledger-worker',
  brokers: [broker],
});

const producer = kafka.producer();

function backoffMs(attempts: number) {
  // 1s, 2s, 4s, 8s ... cap 30s
  const ms = Math.min(30_000, 1000 * Math.pow(2, Math.max(0, attempts)));
  return ms;
}

async function publishOnce() {
  const now = new Date();

  const events = await prisma.outboxEvent.findMany({
    where: {
      status: OutboxStatus.PENDING,
      availableAt: { lte: now },
    },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
  });

  if (events.length === 0) return;

  for (const e of events) {
    try {
      // 先用 updateMany 做“抢占式标记”，避免多 worker 时重复发送
      const claimed = await prisma.outboxEvent.updateMany({
        where: { id: e.id, status: OutboxStatus.PENDING },
        data: { attempts: { increment: 1 } },
      });
      if (claimed.count === 0) continue;

      await producer.send({
        topic,
        messages: [
          {
            key: e.aggregateId,
            value: JSON.stringify({
              id: e.id,
              type: e.type,
              aggregateId: e.aggregateId,
              payload: e.payload,
              createdAt: e.createdAt,
            }),
          },
        ],
      });

      await prisma.outboxEvent.update({
        where: { id: e.id },
        data: { status: OutboxStatus.SENT, sentAt: new Date() },
      });
    } catch (err) {
      const refreshed = await prisma.outboxEvent.findUnique({ where: { id: e.id } });
      const attempts = refreshed?.attempts ?? 1;

      if (attempts >= maxAttempts) {
        await prisma.outboxEvent.update({
          where: { id: e.id },
          data: { status: OutboxStatus.FAILED },
        });
        // TODO: 我们会把 FAILED 推到 DLQ topic（或直接做 consumer-side DLQ）
      } else {
        await prisma.outboxEvent.update({
          where: { id: e.id },
          data: {
            status: OutboxStatus.PENDING,
            availableAt: new Date(Date.now() + backoffMs(attempts)),
          },
        });
      }
      console.error('[outbox] publish failed', { id: e.id, err });
    }
  }
}

async function main() {
  await producer.connect();

  // 这样一个 worker 进程同时做：**outbox publish + kafka consume 入账**；
  // 生产上通常拆成两个 deployment。

  startConsumer(prisma, kafka).catch((e) => {
    console.error('[consumer] crashed', e);
    process.exit(1);
  });

  retryInboxLoop(prisma, kafka).catch((e) => {
    console.error('[retry] crashed', e);
    process.exit(1);
  });

  console.log('[worker] started', { broker, topic, pollIntervalMs, batchSize, maxAttempts });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await publishOnce();
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
