import { Module } from '@nestjs/common';
import { OfficeGateway } from './office.gateway';
import { OfficeService } from './office.service';

@Module({
  providers: [OfficeService, OfficeGateway],
  exports: [OfficeService],
})
export class OfficeModule {}
