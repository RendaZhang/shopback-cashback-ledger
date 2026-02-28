import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('users')
@Controller('users')
export class UsersController {
  @Get(':id/cashback-balance')
  @ApiOperation({ summary: 'Get cashback balance (draft contract)' })
  getBalance(@Param('id') id: string) {
    // mock for Day1
    return {
      userId: id,
      currency: 'SGD',
      balance: 0,
      asOf: new Date().toISOString(),
    };
  }
}
