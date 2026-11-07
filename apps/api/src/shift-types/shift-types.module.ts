import { Module } from '@nestjs/common';
import { ShiftTypesService } from './shift-types.service';
import { ShiftTypesController } from './shift-types.controller';

@Module({
  providers: [ShiftTypesService],
  controllers: [ShiftTypesController],
  exports: [ShiftTypesService],
})
export class ShiftTypesModule {}
