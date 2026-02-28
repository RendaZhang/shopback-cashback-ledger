import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateOrderDto } from './dto/create-order.dto';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  @Post()
  @ApiOperation({ summary: 'Create an order (draft contract)' })
  create(@Body() dto: CreateOrderDto) {
    // mock for Day1
    return {
      id: 'ord_' + Date.now(),
      ...dto,
      status: 'CREATED',
    };
  }

  @Post(':id/confirm')
  @ApiOperation({ summary: 'Confirm an order (draft contract)' })
  confirm(@Param('id') id: string) {
    // mock for Day1
    return {
      id,
      status: 'CONFIRMED',
    };
  }
}
