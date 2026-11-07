import { Body, Controller, Get, Patch } from '@nestjs/common';
import { Role } from '@prisma/client';
import { HospitalsService } from './hospitals.service';
import { UpdateHospitalDto } from './dto/update-hospital.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';

/** FR-A05: ข้อมูลโรงพยาบาลและนโยบายระดับองค์กร */
@Controller('hospitals/mine')
export class HospitalsController {
  constructor(private readonly hospitalsService: HospitalsService) {}

  @Get()
  getMine(@CurrentUser() actor: CurrentUserPayload) {
    return this.hospitalsService.getMine(actor);
  }

  @Roles(Role.SUPER_ADMIN)
  @Patch()
  updateMine(@Body() dto: UpdateHospitalDto, @CurrentUser() actor: CurrentUserPayload) {
    return this.hospitalsService.updateMine(dto, actor);
  }
}
