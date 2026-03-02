import { Kafka } from 'kafkajs';
import { PrismaClient } from '@prisma/client';
import { processOrderConfirmed } from '../../../packages/domain/src/process-order-confirmed';

export async function startConsumer(prisma: PrismaClient, kafka: Kafka) {
  const topic = process.env.EVENT_TOPIC ?? 'order.events';
  const dlqTopic = process.env.DLQ_TOPIC ?? 'order.events.dlq';
  const groupId = process.env.CONSUMER_GROUP ?? 'sb-ledger-consumer';

  const consumer = kafka.consumer({ groupId });
  const producer = kafka.producer();

  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: true });

  console.log('[consumer] started', { topic, groupId, dlqTopic });

  await consumer.run({
    eachMessage: async ({ message }) => {
      const raw = message.value?.toString('utf8') ?? '';
      try {
        const evt = JSON.parse(raw);
        if (evt?.type !== 'OrderConfirmed') return;

        const payload = evt.payload ?? {};
        await processOrderConfirmed(prisma, { orderId: payload.orderId });

      } catch (err: any) {
        console.error('[consumer] failed', { err: String(err), raw });

        // send to DLQ then swallow error (so we don't block partition forever in demo)
        await producer.send({
          topic: dlqTopic,
          messages: [
            {
              key: message.key?.toString('utf8') ?? 'unknown',
              value: JSON.stringify({ raw, error: String(err), at: new Date().toISOString() }),
            },
          ],
        });
      }
    },
  });
}
