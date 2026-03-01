import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../db/prisma.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id/cashback-balance')
  @ApiOperation({ summary: 'Get cashback balance (aggregated from ledger)' })
  async getBalance(@Param('id') id: string) {
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['currency', 'type'],
      where: { userId: id },
      _sum: { amount: true },
    });

    // credit - debit per currency
    const byCurrency = new Map<string, number>();
    for (const r of rows) {
      const cur = r.currency;
      const sum = r._sum.amount ? Number(r._sum.amount) : 0;
      const sign = r.type === 'CREDIT' ? 1 : -1;
      byCurrency.set(cur, (byCurrency.get(cur) ?? 0) + sign * sum);
    }

    // demo: return one currency if exists, else SGD 0
    const first = byCurrency.entries().next();
    if (!first.done) {
      const [currency, balance] = first.value;
      return { userId: id, currency, balance, asOf: new Date().toISOString() };
    }
    return { userId: id, currency: 'SGD', balance: 0, asOf: new Date().toISOString() };
  }
}
