import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@sb/db';
import { PrismaService } from '../db/prisma.service';
import { UpsertCashbackRuleDto } from './dto/upsert-cashback-rule.dto';
import { CashbackRuleService } from './cashback-rule.service';

@ApiTags('merchants')
@Controller('merchants')
export class MerchantsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cashbackRuleService: CashbackRuleService,
  ) {}

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

    await this.cashbackRuleService.invalidate(merchantId);

    return {
      merchantId: rule.merchantId,
      rate: Number(rule.rate),
      cap: rule.cap ? Number(rule.cap) : null,
    };
  }
}
