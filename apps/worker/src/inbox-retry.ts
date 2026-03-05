import { Kafka } from 'kafkajs';
import { InboxStatus, PrismaClient } from '@prisma/client';
import { processOrderConfirmed } from './handlers/process-order-confirmed';

const dlqTopic = process.env.DLQ_TOPIC ?? 'order.events.dlq';
const maxAttempts = Number(process.env.MAX_ATTEMPTS ?? '5');
const batchSize = Number(process.env.RETRY_BATCH_SIZE ?? '50');

function backoffMs(attempts: number) {
  return Math.min(30_000, 1000 * Math.pow(2, Math.max(0, attempts)));
}

export async function retryInboxLoop(prisma: PrismaClient, kafka: Kafka) {
  const producer = kafka.producer();
  await producer.connect();
  console.log('[retry] inbox loop started', { dlqTopic, maxAttempts, batchSize });

  for (;;) {
    const now = new Date();
    const events = await prisma.inboxEvent.findMany({
      where: { status: InboxStatus.PENDING, availableAt: { lte: now } },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    });

    for (const e of events) {
      try {
        const payload = e.payload as { orderId?: string };
        if (!payload.orderId) {
          throw new Error(`Missing orderId in inbox payload for event ${e.id}`);
        }

        await processOrderConfirmed(prisma, { orderId: payload.orderId });
        await prisma.inboxEvent.update({
          where: { id: e.id },
          data: { status: InboxStatus.PROCESSED, processedAt: new Date(), lastError: null },
        });
      } catch (err: unknown) {
        const updated = await prisma.inboxEvent.update({
          where: { id: e.id },
          data: {
            attempts: { increment: 1 },
            lastError: String(err),
          },
        });

        if (updated.attempts >= maxAttempts) {
          await prisma.inboxEvent.update({
            where: { id: e.id },
            data: { status: InboxStatus.FAILED },
          });

          await producer.send({
            topic: dlqTopic,
            messages: [
              {
                key: updated.sourceEventId,
                value: JSON.stringify({
                  sourceEventId: updated.sourceEventId,
                  type: updated.type,
                  payload: updated.payload,
                  attempts: updated.attempts,
                  lastError: updated.lastError,
                  at: new Date().toISOString(),
                }),
              },
            ],
          });
        } else {
          await prisma.inboxEvent.update({
            where: { id: e.id },
            data: { availableAt: new Date(Date.now() + backoffMs(updated.attempts)) },
          });
        }
      }
    }

    await new Promise((r) => setTimeout(r, Number(process.env.RETRY_POLL_INTERVAL_MS ?? '1000')));
  }
}
