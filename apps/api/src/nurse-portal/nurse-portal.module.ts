import { Module } from '@nestjs/common';
import { NursePortalService } from './nurse-portal.service';
import { NursePortalController } from './nurse-portal.controller';

@Module({
  providers: [NursePortalService],
  controllers: [NursePortalController],
})
export class NursePortalModule {}
