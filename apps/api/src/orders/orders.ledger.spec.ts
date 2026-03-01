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
import { OrdersController } from './orders.controller';

describe('OrdersController ledger credit idempotency', () => {
  afterEach(() => {
    // Keep tests isolated and avoid cross-test pollution from jest call history.
    jest.clearAllMocks();
  });

  it('confirm credits exactly once even if called multiple times', async () => {
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

    const tx = {
      order: {
        findUnique: jest.fn(async () => order),
        update: jest.fn(async () => {
          order.status = OrderStatus.CONFIRMED;
          return order;
        }),
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

    // Unit test only: Prisma is fully mocked, so no real DB write happens.
    const prisma = {
      $transaction: jest.fn(async (cb: (innerTx: typeof tx) => Promise<unknown>) => cb(tx)),
    };

    const idem = {
      hashRequest: jest.fn(),
      getCachedResponse: jest.fn(),
      saveResponse: jest.fn(),
    };

    const controller = new OrdersController(prisma as any, idem as any);

    const first = await controller.confirm(undefined, order.id);
    const second = await controller.confirm(undefined, order.id);

    expect(first.ledgerEntryId).toBe(existingCreditEntry.id);
    expect(second.ledgerEntryId).toBe(existingCreditEntry.id);
    expect(tx.ledgerEntry.create).toHaveBeenCalledTimes(2);
    expect(tx.ledgerEntry.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.ledgerEntry.findUnique).toHaveBeenCalledWith({
      where: {
        orderId_type: {
          orderId: order.id,
          type: LedgerEntryType.CREDIT,
        },
      },
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

    const controller = new OrdersController(prisma as any, idem as any);

    await expect(controller.confirm(undefined, 'order-cancelled')).rejects.toBeInstanceOf(ConflictException);
  });
});
