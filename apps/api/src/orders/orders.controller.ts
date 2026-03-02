import { Body, ConflictException, Controller, Headers, Param, Post, Req } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { OrderStatus, Prisma } from '@prisma/client';
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

      const resp = await this.confirmAndOutbox(id);

      await this.idem.saveResponse({
        key: idemKey,
        scope,
        requestHash,
        responseBody: resp,
        ttlSeconds: 24 * 3600,
      });

      return resp;
    }

    return this.confirmAndOutbox(id);
  }

  private async confirmAndOutbox(orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw new ConflictException('Order not found');

      if (order.status === OrderStatus.CANCELLED) {
        throw new ConflictException('Cannot confirm a cancelled order');
      }

      // confirm is idempotent: CREATED -> CONFIRMED; CONFIRMED stays CONFIRMED
      // IMPORTANT: only create outbox when transitioning to CONFIRMED
      if (order.status === OrderStatus.CONFIRMED) {
        return { id: order.id, status: order.status, outboxEventId: null };
      }

      if (order.status !== OrderStatus.CREATED) {
        throw new ConflictException(`Cannot confirm order in status ${order.status}`);
      }

      const confirmed = await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CONFIRMED },
      });

      const outbox = await tx.outboxEvent.create({
        data: {
          aggregateId: confirmed.id,
          type: 'OrderConfirmed',
          payload: {
            orderId: confirmed.id,
            userId: confirmed.userId,
            merchantId: confirmed.merchantId,
            amount: confirmed.amount.toString(),
            currency: confirmed.currency,
            confirmedAt: new Date().toISOString(),
          },
        },
      });

      return { id: confirmed.id, status: confirmed.status, outboxEventId: outbox.id };
    });
  }
}
