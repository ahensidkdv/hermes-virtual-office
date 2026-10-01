import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from './entities/task.entity';
import { Agent } from './entities/agent.entity';
import { TasksModule } from './tasks/tasks.module';
import { AgentsModule } from './agents/agents.module';
import { OfficeModule } from './office/office.module';
import { HealthController } from './health.controller';
import { RealHermesAdapter } from './adapters/real-hermes.adapter';
import { HeartbeatMonitoringService } from './services/heartbeat.service';
import { AlertService } from './services/alert.service';
import { CloudEventService } from './events/cloud-event.service';
import { SharedMemoryService } from './services/shared-memory.service';
import { ConflictDetectionService } from './services/conflict-detection.service';
import { AuditTrailService } from './services/audit-trail.service';
import { PeriodicHeartbeatCheckService } from './services/periodic-heartbeat-check.service';
import { AlertEscalationService } from './services/alert-escalation.service';
import { AgentRecoveryService } from './services/agent-recovery.service';

/**
 * Root application module
 * Integrates Phase 0-1 (core functionality) + Phase 2 (Hermes + Heartbeat)
 */
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
  providers: [
    // Phase 2: Real Hermes integration + Heartbeat monitoring + Alerts
    RealHermesAdapter,
    HeartbeatMonitoringService,
    AlertService,
    // Phase 2 Sprint 3 Week 2: Periodic checks + Escalation + Recovery
    PeriodicHeartbeatCheckService,
    AlertEscalationService,
    AgentRecoveryService,
    SharedMemoryService,
    ConflictDetectionService,
    AuditTrailService,
    // Core services
    CloudEventService,
  ],
  exports: [
    RealHermesAdapter,
    HeartbeatMonitoringService,
    AlertService,
    PeriodicHeartbeatCheckService,
    AlertEscalationService,
    AgentRecoveryService,
    SharedMemoryService,
    ConflictDetectionService,
    AuditTrailService,
    CloudEventService,
  ],
})
export class AppModule {
  constructor(
    private hermesAdapter: RealHermesAdapter,
    private heartbeatService: HeartbeatMonitoringService,
    private alertService: AlertService,
  ) {}
}

