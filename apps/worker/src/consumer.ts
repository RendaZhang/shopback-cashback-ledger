import { Kafka } from 'kafkajs';
import { InboxStatus, PrismaClient } from '@prisma/client';
import { processOrderConfirmed } from './handlers/process-order-confirmed';

export async function startConsumer(prisma: PrismaClient, kafka: Kafka) {
  const topic = process.env.EVENT_TOPIC ?? 'order.events';
  const groupId = process.env.CONSUMER_GROUP ?? 'sb-ledger-consumer';

  const consumer = kafka.consumer({ groupId });

  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: true });

  console.log('[consumer] started', { topic, groupId });

  await consumer.run({
    eachMessage: async ({ message }) => {
      const raw = message.value?.toString('utf8') ?? '';
      const key = message.key?.toString('utf8') ?? 'unknown';

      try {
        const evt = JSON.parse(raw);
        if (evt?.type !== 'OrderConfirmed') return;

        const sourceEventId = String(evt.id ?? key);
        const payload = evt.payload ?? {};
        // 1) durable: write inbox (dedupe by sourceEventId)
        const inbox = await prisma.inboxEvent.upsert({
          where: { sourceEventId },
          update: {},
          create: {
            sourceEventId,
            type: evt.type,
            payload,
            status: InboxStatus.PENDING,
          },
        });

        // 2) fast path: try once immediately
        await processOrderConfirmed(prisma, { orderId: payload.orderId });
        await prisma.inboxEvent.update({
          where: { id: inbox.id },
          data: { status: InboxStatus.PROCESSED, processedAt: new Date(), lastError: null },
        });
      } catch (err: unknown) {
        // do not throw -> avoid blocking partition; retry loop will handle PENDING rows
        console.error('[consumer] inbox created but processing failed (will retry)', {
          err: String(err),
          raw,
        });
      }
    },
  });
}
