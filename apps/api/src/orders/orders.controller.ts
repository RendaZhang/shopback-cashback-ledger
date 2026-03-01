import { Body, ConflictException, Controller, Headers, Param, Post, Req } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { LedgerEntryType, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../db/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { IdempotencyService } from '../common/idempotency/idempotency.service';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idem: IdempotencyService,
  ) {}

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Create an order (idempotent)' })
  async create(
    @Req() req: Request,
    @Headers('idempotency-key') idemKey: string | undefined,
    @Body() dto: CreateOrderDto,
  ) {
    const scope = 'POST:/orders';

    if (idemKey) {
      const requestHash = this.idem.hashRequest('POST', '/orders', dto);
      const cached = await this.idem.getCachedResponse(idemKey, scope);
      if (cached) {
        if (cached.requestHash !== requestHash) {
          throw new ConflictException('Idempotency-Key reused with different request body');
        }
        return cached.responseBody;
      }

      const created = await this.prisma.order.create({
        data: {
          userId: dto.userId,
          merchantId: dto.merchantId,
          amount: new Prisma.Decimal(dto.amount),
          currency: dto.currency,
          status: OrderStatus.CREATED,
        },
      });

      const resp = {
        id: created.id,
        userId: created.userId,
        merchantId: created.merchantId,
        amount: created.amount.toNumber(),
        currency: created.currency,
        status: created.status,
        createdAt: created.createdAt,
      };

      await this.idem.saveResponse({
        key: idemKey,
        scope,
        requestHash,
        responseBody: resp,
        ttlSeconds: 24 * 3600,
      });

      return resp;
    }

    const created = await this.prisma.order.create({
      data: {
        userId: dto.userId,
        merchantId: dto.merchantId,
        amount: new Prisma.Decimal(dto.amount),
        currency: dto.currency,
        status: OrderStatus.CREATED,
      },
    });

    return {
      id: created.id,
      userId: created.userId,
      merchantId: created.merchantId,
      amount: created.amount.toNumber(),
      currency: created.currency,
      status: created.status,
      createdAt: created.createdAt,
    };
  }

  @Post(':id/confirm')
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Confirm an order (idempotent + transactional + ledger credit)' })
  async confirm(@Headers('idempotency-key') idemKey: string | undefined, @Param('id') id: string) {
    const scope = `POST:/orders/${id}/confirm`;

    if (idemKey) {
      const requestHash = this.idem.hashRequest('POST', `/orders/${id}/confirm`, null);
      const cached = await this.idem.getCachedResponse(idemKey, scope);
      if (cached) {
        if (cached.requestHash !== requestHash) {
          throw new ConflictException('Idempotency-Key reused with different request');
        }
        return cached.responseBody;
      }

      const resp = await this.confirmAndCredit(id);

      await this.idem.saveResponse({
        key: idemKey,
        scope,
        requestHash,
        responseBody: resp,
        ttlSeconds: 24 * 3600,
      });

      return resp;
    }

    return this.confirmAndCredit(id);
  }

  private async confirmAndCredit(orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw new ConflictException('Order not found');

      if (order.status === OrderStatus.CANCELLED) {
        throw new ConflictException('Cannot confirm a cancelled order');
      }

      // confirm is idempotent: CREATED -> CONFIRMED; CONFIRMED stays CONFIRMED
      const confirmed =
        order.status === OrderStatus.CONFIRMED
          ? order
          : await tx.order.update({ where: { id: orderId }, data: { status: OrderStatus.CONFIRMED } });

      // cashback rule (fallback default 5%)
      const rule = await tx.cashbackRule.findUnique({ where: { merchantId: confirmed.merchantId } });
      const rate = rule?.rate ?? new Prisma.Decimal('0.05');

      let cashback = confirmed.amount.mul(rate);
      if (rule?.cap && cashback.greaterThan(rule.cap)) cashback = rule.cap;
      cashback = cashback.toDecimalPlaces(2);

      // Ensure ledger credit exactly once (DB unique + app-level idempotency)
      let entry = null as any;
      try {
        entry = await tx.ledgerEntry.create({
          data: {
            userId: confirmed.userId,
            orderId: confirmed.id,
            type: LedgerEntryType.CREDIT,
            amount: cashback,
            currency: confirmed.currency,
          },
        });
      } catch (e: any) {
        // unique(orderId, type) hit => already credited
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          entry = await tx.ledgerEntry.findUnique({
            where: { orderId_type: { orderId: confirmed.id, type: LedgerEntryType.CREDIT } },
          });
        } else {
          throw e;
        }
      }

      return {
        id: confirmed.id,
        status: confirmed.status,
        cashback: { amount: cashback.toNumber(), currency: confirmed.currency },
        ledgerEntryId: entry?.id ?? null,
      };
    });
  }
}
