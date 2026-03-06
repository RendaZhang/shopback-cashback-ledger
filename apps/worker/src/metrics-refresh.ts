import { InboxStatus, OutboxStatus, PrismaClient } from '@sb/db';
import { inboxFailedGauge, inboxPendingGauge, outboxPendingGauge } from './metrics';

export function startMetricsRefresh(prisma: PrismaClient) {
  const intervalMs = Number(process.env.METRICS_REFRESH_MS ?? '2000');

  async function tick() {
    try {
      const [inboxPending, inboxFailed, outboxPending] = await Promise.all([
        prisma.inboxEvent.count({ where: { status: InboxStatus.PENDING } }),
        prisma.inboxEvent.count({ where: { status: InboxStatus.FAILED } }),
        prisma.outboxEvent.count({ where: { status: OutboxStatus.PENDING } }),
      ]);

      inboxPendingGauge.set(inboxPending);
      inboxFailedGauge.set(inboxFailed);
      outboxPendingGauge.set(outboxPending);
    } catch (e) {
      console.error('[metrics] refresh failed', e);
    }
  }

  void tick();
  setInterval(() => {
    void tick();
  }, intervalMs);
}
