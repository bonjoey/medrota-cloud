import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CounterpartyDecisionDto {
  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class AdminDecisionDto {
  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  rejectionReason?: string;
}
