import { ConflictException } from '@nestjs/common';

class MockDecimal {
  private value: number;

  constructor(value: string | number | MockDecimal) {
    if (value instanceof MockDecimal) {
      this.value = value.value;
      return;
    }

    this.value = typeof value === 'string' ? Number.parseFloat(value) : value;
  }

  mul(other: MockDecimal | number) {
    const next = other instanceof MockDecimal ? other.value : other;
    return new MockDecimal(this.value * next);
  }

  greaterThan(other: MockDecimal | number) {
    const next = other instanceof MockDecimal ? other.value : other;
    return this.value > next;
  }

  toDecimalPlaces(dp: number) {
    const scale = 10 ** dp;
    return new MockDecimal(Math.round(this.value * scale) / scale);
  }

  toNumber() {
    return this.value;
  }
}

class MockPrismaClientKnownRequestError extends Error {
  code: string;

  constructor(message: string, opts: { code: string; clientVersion: string }) {
    super(message);
    this.code = opts.code;
  }
}

jest.mock('@prisma/client', () => ({
  PrismaClient: class PrismaClient {},
  LedgerEntryType: { CREDIT: 'CREDIT' },
  OrderStatus: { CREATED: 'CREATED', CONFIRMED: 'CONFIRMED', CANCELLED: 'CANCELLED' },
  Prisma: {
    Decimal: MockDecimal,
    PrismaClientKnownRequestError: MockPrismaClientKnownRequestError,
  },
}));

import { LedgerEntryType, OrderStatus, Prisma } from '@prisma/client';
import type { IdempotencyService } from '../common/idempotency/idempotency.service';
import type { PrismaService } from '../db/prisma.service';
import { OrdersController } from './orders.controller';
import { processOrderConfirmed } from '../../../../packages/domain/src/process-order-confirmed';

describe('OrdersController ledger credit idempotency', () => {
  afterEach(() => {
    // Keep tests isolated and avoid cross-test pollution from jest call history.
    jest.clearAllMocks();
  });

  it('confirm does not credit ledger; consumer credits exactly once', async () => {
    const order = {
      id: 'order-1',
      userId: 'user-1',
      merchantId: 'merchant-1',
      amount: new Prisma.Decimal('100'),
      currency: 'SGD',
      status: OrderStatus.CREATED,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const existingCreditEntry = {
      id: 'ledger-1',
      userId: order.userId,
      orderId: order.id,
      type: LedgerEntryType.CREDIT,
      amount: new Prisma.Decimal('5.00'),
      currency: order.currency,
      createdAt: new Date(),
    };

    const outboxEvent = {
      id: 'outbox-1',
      aggregateId: order.id,
      type: 'OrderConfirmed',
      payload: {},
      createdAt: new Date(),
      processedAt: null,
    };

    const tx = {
      order: {
        findUnique: jest.fn(async () => order),
        update: jest.fn(async () => {
          order.status = OrderStatus.CONFIRMED;
          return order;
        }),
      },
      outboxEvent: {
        create: jest.fn(async () => outboxEvent),
        findFirst: jest.fn(async () => outboxEvent),
      },
    };

    // Unit test only: Prisma is fully mocked, so no real DB write happens.
    const prisma = {
      $transaction: jest.fn(async (cb: (innerTx: typeof tx) => Promise<unknown>) => cb(tx)),
    };

    const idem = {
      hashRequest: jest.fn(),
      getCachedResponse: jest.fn(),
      saveResponse: jest.fn(),
    };

    const controller = new OrdersController(
      prisma as unknown as PrismaService,
      idem as unknown as IdempotencyService,
    );

    const firstConfirm = await controller.confirm(undefined, order.id);
    const secondConfirm = await controller.confirm(undefined, order.id);

    expect(firstConfirm).toEqual({ id: order.id, status: OrderStatus.CONFIRMED, outboxEventId: outboxEvent.id });
    expect(secondConfirm).toEqual({ id: order.id, status: OrderStatus.CONFIRMED, outboxEventId: null });
    expect(tx.outboxEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.outboxEvent.findFirst).toHaveBeenCalledTimes(0);

    const consumerTx = {
      order: {
        findUnique: jest.fn(async () => order),
      },
      cashbackRule: {
        findUnique: jest.fn(async () => ({
          merchantId: order.merchantId,
          rate: new Prisma.Decimal('0.05'),
          cap: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      },
      ledgerEntry: {
        create: jest
          .fn()
          .mockResolvedValueOnce(existingCreditEntry)
          .mockRejectedValueOnce(
            new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields', {
              code: 'P2002',
              clientVersion: 'test',
            }),
          ),
        findUnique: jest.fn(async () => existingCreditEntry),
      },
    };

    const consumerPrisma = {
      $transaction: jest.fn(async (cb: (innerTx: typeof consumerTx) => Promise<unknown>) => cb(consumerTx)),
    };

    const firstConsume = await processOrderConfirmed(consumerPrisma as any, { orderId: order.id });
    const secondConsume = await processOrderConfirmed(consumerPrisma as any, { orderId: order.id });

    expect(firstConsume).toEqual({
      orderId: order.id,
      credited: true,
      ledgerEntryId: existingCreditEntry.id,
      cashback: { amount: 5, currency: order.currency },
    });
    expect(secondConsume).toEqual({
      orderId: order.id,
      credited: false,
      ledgerEntryId: existingCreditEntry.id,
      cashback: { amount: 5, currency: order.currency },
    });
    expect(consumerTx.ledgerEntry.create).toHaveBeenCalledTimes(2);
    expect(consumerTx.ledgerEntry.findUnique).toHaveBeenCalledTimes(1);
    expect(consumerTx.ledgerEntry.findUnique).toHaveBeenCalledWith({
      where: { orderId_type: { orderId: order.id, type: LedgerEntryType.CREDIT } },
    });
  });

  it('throws conflict when confirming a cancelled order', async () => {
    const tx = {
      order: {
        findUnique: jest.fn(async () => ({
          id: 'order-cancelled',
          userId: 'user-1',
          merchantId: 'merchant-1',
          amount: new Prisma.Decimal('10'),
          currency: 'SGD',
          status: OrderStatus.CANCELLED,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      },
    };

    // Unit test only: Prisma is fully mocked, so no real DB write happens.
    const prisma = {
      $transaction: jest.fn(async (cb: (innerTx: typeof tx) => Promise<unknown>) => cb(tx)),
    };

    const idem = {
      hashRequest: jest.fn(),
      getCachedResponse: jest.fn(),
      saveResponse: jest.fn(),
    };

    const controller = new OrdersController(
      prisma as unknown as PrismaService,
      idem as unknown as IdempotencyService,
    );

    await expect(controller.confirm(undefined, 'order-cancelled')).rejects.toBeInstanceOf(ConflictException);
  });
});
