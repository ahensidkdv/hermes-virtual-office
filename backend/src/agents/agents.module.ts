import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Agent } from '../entities/agent.entity';
import { AgentsService } from './agents.service';
import { AgentsController } from './agents.controller';
import { MockManagerAgent } from './mock-manager-agent.service';
import { TasksModule } from '../tasks/tasks.module';
import { MockHermesAdapter } from '../adapters/mock-hermes.adapter';
import { OfficeModule } from '../office/office.module';

@Module({
  imports: [TypeOrmModule.forFeature([Agent]), TasksModule, OfficeModule],
  providers: [AgentsService, MockManagerAgent, MockHermesAdapter],
  controllers: [AgentsController],
  exports: [AgentsService, MockHermesAdapter],
})
export class AgentsModule {}
