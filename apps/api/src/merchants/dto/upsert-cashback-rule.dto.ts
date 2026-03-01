import { IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpsertCashbackRuleDto {
  @IsNumber()
  @Min(0)
  @Max(1)
  rate!: number; // 0.05 = 5%

  @IsOptional()
  @IsNumber()
  @Min(0)
  cap?: number; // optional cap
}
