import { LedgerEntryType, OrderStatus, Prisma, PrismaClient } from '@sb/db';
import { getCashbackRule } from '../cache/cashback-rule-cache';

export type OrderConfirmedPayload = {
  orderId: string;
  userId?: string;
  merchantId?: string;
  amount?: string;
  currency?: string;
  confirmedAt?: string;
};

export async function processOrderConfirmed(prisma: PrismaClient, payload: OrderConfirmedPayload) {
  const orderId = payload.orderId;

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new Error(`Order not found: ${orderId}`);
    if (order.status !== OrderStatus.CONFIRMED) {
      throw new Error(`Order not confirmed: ${orderId} status=${order.status}`);
    }

    const rule = await getCashbackRule(tx, order.merchantId);
    const rate = rule.rate;

    let cashback = order.amount.mul(rate);
    if (rule?.cap && cashback.greaterThan(rule.cap)) cashback = rule.cap;
    cashback = cashback.toDecimalPlaces(2);

    try {
      const entry = await tx.ledgerEntry.create({
        data: {
          userId: order.userId,
          orderId: order.id,
          type: LedgerEntryType.CREDIT,
          amount: cashback,
          currency: order.currency,
        },
      });

      return {
        orderId: order.id,
        credited: true,
        ledgerEntryId: entry.id,
        cashback: { amount: cashback.toNumber(), currency: order.currency },
      };
    } catch (e: unknown) {
      // unique(orderId,type) => already processed (idempotent consumer)
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await tx.ledgerEntry.findUnique({
          where: { orderId_type: { orderId: order.id, type: LedgerEntryType.CREDIT } },
        });
        return {
          orderId: order.id,
          credited: false,
          ledgerEntryId: existing?.id ?? null,
          cashback: { amount: cashback.toNumber(), currency: order.currency },
        };
      }
      throw e;
    }
  });
}
