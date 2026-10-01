import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from './entities/task.entity';
import { Agent } from './entities/agent.entity';
import { TasksModule } from './tasks/tasks.module';
import { AgentsModule } from './agents/agents.module';
import { OfficeModule } from './office/office.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'production' ? '.env.prod' : '.env',
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'postgres',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'hvo',
      entities: [Task, Agent],
      synchronize: false,
      logging: process.env.NODE_ENV !== 'production',
      migrations: ['dist/database/migrations/*{.ts,.js}'],
      migrationsRun: false,
    }),
    TasksModule,
    AgentsModule,
    OfficeModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
