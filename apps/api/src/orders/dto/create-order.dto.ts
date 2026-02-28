import { IsIn, IsNumber, IsString, Min } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  userId!: string;

  @IsString()
  merchantId!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsString()
  @IsIn(['SGD', 'USD', 'CNY'])
  currency!: string;
}
