import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../db/prisma.service';
import { UpsertCashbackRuleDto } from './dto/upsert-cashback-rule.dto';

@ApiTags('merchants')
@Controller('merchants')
export class MerchantsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post(':id/cashback-rule')
  @ApiOperation({ summary: 'Upsert cashback rule for a merchant' })
  async upsertRule(@Param('id') merchantId: string, @Body() dto: UpsertCashbackRuleDto) {
    const rule = await this.prisma.cashbackRule.upsert({
      where: { merchantId },
      update: {
        rate: new Prisma.Decimal(dto.rate),
        cap: dto.cap === undefined ? null : new Prisma.Decimal(dto.cap),
      },
      create: {
        merchantId,
        rate: new Prisma.Decimal(dto.rate),
        cap: dto.cap === undefined ? null : new Prisma.Decimal(dto.cap),
      },
    });

    return {
      merchantId: rule.merchantId,
      rate: Number(rule.rate),
      cap: rule.cap ? Number(rule.cap) : null,
    };
  }
}
