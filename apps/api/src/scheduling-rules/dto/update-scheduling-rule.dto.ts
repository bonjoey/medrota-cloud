import { PartialType } from '@nestjs/mapped-types';
import { CreateSchedulingRuleDto } from './create-scheduling-rule.dto';

export class UpdateSchedulingRuleDto extends PartialType(CreateSchedulingRuleDto) {}
