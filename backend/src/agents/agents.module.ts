import { Module } from '@nestjs/common';
import { MockManagerAgent } from './mock-manager-agent.service';
import { TasksModule } from '../tasks/tasks.module';

@Module({
  imports: [TasksModule],
  providers: [MockManagerAgent],
  exports: [MockManagerAgent],
})
export class AgentsModule {}
