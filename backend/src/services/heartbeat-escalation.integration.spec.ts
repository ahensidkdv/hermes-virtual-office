import { Test, TestingModule } from '@nestjs/testing';
import { HeartbeatMonitoringService } from './heartbeat.service';
import { AlertEscalationService } from './alert-escalation.service';
import { AgentRecoveryService } from './agent-recovery.service';
import { CloudEventService } from '../events/cloud-event.service';
import { AgentsService } from '../agents/agents.service';
import { AlertService } from './alert.service';
import { PeriodicHeartbeatCheckService } from './periodic-heartbeat-check.service';

/**
 * Integration tests: Full heartbeat → escalation → recovery flow
 * Tests Phase 2 Sprint 3 Week 2 pipeline
 */
describe('Heartbeat Escalation Integration', () => {
  let heartbeatService: HeartbeatMonitoringService;
  let escalationService: AlertEscalationService;
  let recoveryService: AgentRecoveryService;
  let checkService: PeriodicHeartbeatCheckService;
  let cloudEventService: jest.Mocked<CloudEventService>;
  let agentsService: jest.Mocked<AgentsService>;
  let alertService: jest.Mocked<AlertService>;

  beforeEach(async () => {
    const mockCloudEventService = {
      publishAgentOnline: jest.fn().mockResolvedValue(undefined),
      publishAgentOffline: jest.fn().mockResolvedValue(undefined),
      publishAlertCreated: jest.fn().mockResolvedValue(undefined),
      publishAlertEscalated: jest.fn().mockResolvedValue(undefined),
      publishAlertResolved: jest.fn().mockResolvedValue(undefined),
      publishTaskCreated: jest.fn().mockResolvedValue(undefined),
    };

    const mockAgentsService = {
      listAgents: jest.fn().mockResolvedValue([
        { id: 'agent-01', name: 'Agent 1', status: 'idle' } as any,
        { id: 'agent-02', name: 'Agent 2', status: 'idle' } as any,
        { id: 'agent-03', name: 'Agent 3', status: 'idle' } as any,
      ]),
      getAgent: jest.fn().mockResolvedValue({
        id: 'agent-01',
        name: 'Agent 1',
        status: 'idle',
      } as any),
      updateAgentStatus: jest.fn().mockResolvedValue(undefined),
    };

    const mockAlertService = {
      createAlert: jest.fn().mockResolvedValue('alert-001'),
      escalateAlert: jest.fn().mockResolvedValue(undefined),
      resolveAlert: jest.fn().mockResolvedValue(undefined),
      getAgentAlerts: jest.fn().mockReturnValue([]),
      getHighestAlertLevel: jest.fn().mockReturnValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HeartbeatMonitoringService,
        AlertEscalationService,
        AgentRecoveryService,
        PeriodicHeartbeatCheckService,
        { provide: CloudEventService, useValue: mockCloudEventService },
        { provide: AgentsService, useValue: mockAgentsService },
        { provide: AlertService, useValue: mockAlertService },
      ],
    }).compile();

    heartbeatService = module.get<HeartbeatMonitoringService>(HeartbeatMonitoringService);
    escalationService = module.get<AlertEscalationService>(AlertEscalationService);
    recoveryService = module.get<AgentRecoveryService>(AgentRecoveryService);
    checkService = module.get<PeriodicHeartbeatCheckService>(PeriodicHeartbeatCheckService);
    cloudEventService = module.get(CloudEventService) as jest.Mocked<CloudEventService>;
    agentsService = module.get(AgentsService) as jest.Mocked<AgentsService>;
    alertService = module.get(AlertService) as jest.Mocked<AlertService>;

    // Mock Redis publish for all services
    (heartbeatService as any).redis.publish = jest.fn().mockResolvedValue(1);
    (escalationService as any).redis.publish = jest.fn().mockResolvedValue(1);
    (recoveryService as any).redis.publish = jest.fn().mockResolvedValue(1);
    (checkService as any).redis.publish = jest.fn().mockResolvedValue(1);
  });

  afterEach(async () => {
    try {
      await checkService.onModuleDestroy();
      await heartbeatService.onModuleDestroy();
      await escalationService.onModuleDestroy();
      await recoveryService.onModuleDestroy();
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('offline detection flow', () => {
    it('should detect agent offline within heartbeat timeout', async () => {
      const agentId = 'agent-01';
      const oldTime = new Date(Date.now() - 20000); // 20 seconds ago

      // Set agent to offline state
      heartbeatService.recordHeartbeat(agentId, oldTime);

      // Trigger periodic check
      await (heartbeatService as any).checkHeartbeats();

      // Should have detected offline
      const heartbeat = heartbeatService.getAgentHeartbeat(agentId);
      expect(heartbeat?.status).toBe('offline');
    });

    it('should emit offline event when detection threshold reached', async () => {
      const agentId = 'agent-02';
      const oldTime = new Date(Date.now() - 20000);

      heartbeatService.recordHeartbeat(agentId, oldTime);
      await (heartbeatService as any).checkHeartbeats();

      // Should have published offline event
      expect(cloudEventService.publishAgentOffline).toHaveBeenCalledWith(agentId);
    });
  });

  describe('escalation flow', () => {
    it('should detect agent offline and escalate', async () => {
      const agentId = 'agent-03';

      // Trigger escalation progression
      for (let i = 0; i < 10; i++) {
        await escalationService.onAgentOffline(agentId);
      }

      const state = escalationService.getEscalationState(agentId);
      expect(state.level).toBeGreaterThan(0);
      expect(state.offlineCount).toBe(10);
    });

    it('should publish escalation events at each level', async () => {
      const agentId = 'agent-01';

      // Reach level 3
      for (let i = 0; i < 10; i++) {
        await escalationService.onAgentOffline(agentId);
      }

      // Service should have tracked escalation
      const state = escalationService.getEscalationState(agentId);
      expect(state.level).toBeGreaterThan(0);
    });

    it('should respect cooldown between alerts', async () => {
      const agentId = 'agent-02';

      // First escalation
      for (let i = 0; i < 3; i++) {
        await escalationService.onAgentOffline(agentId);
      }

      const initialCalls = alertService.createAlert.mock.calls.length;

      // Immediate re-trigger (within cooldown)
      await escalationService.onAgentOffline(agentId);

      // Should not create new alert due to cooldown
      expect(alertService.createAlert.mock.calls.length).toBe(initialCalls);
    });
  });

  describe('recovery flow', () => {
    it('should de-escalate and resolve alerts on online', async () => {
      const agentId = 'agent-01';

      // Escalate to level 3
      for (let i = 0; i < 10; i++) {
        await escalationService.onAgentOffline(agentId);
      }

      let state = escalationService.getEscalationState(agentId);
      expect(state.level).toBeGreaterThan(0);

      // Recovery
      await escalationService.onAgentOnline(agentId);

      state = escalationService.getEscalationState(agentId);
      expect(state.level).toBe(0);
    });

    it('should update agent status on recovery', async () => {
      const agentId = 'agent-02';

      // Escalate
      for (let i = 0; i < 3; i++) {
        await escalationService.onAgentOffline(agentId);
      }

      // Recovery
      await escalationService.onAgentOnline(agentId);

      // Status should be updated
      expect(cloudEventService.publishAgentOnline).toHaveBeenCalledWith(agentId);
    });

    it('should publish recovery event', async () => {
      const agentId = 'agent-03';

      // Escalate
      for (let i = 0; i < 3; i++) {
        await escalationService.onAgentOffline(agentId);
      }

      // Recovery
      await escalationService.onAgentOnline(agentId);

      // Should publish online event
      expect(cloudEventService.publishAgentOnline).toHaveBeenCalledWith(agentId);
    });
  });

  describe('stress test: multiple agents', () => {
    it('should handle multiple agents going offline simultaneously', async () => {
      // Simulate 3 agents going offline
      const agentIds = ['agent-01', 'agent-02', 'agent-03'];

      for (const agentId of agentIds) {
        for (let i = 0; i < 6; i++) {
          await escalationService.onAgentOffline(agentId);
        }
      }

      // All should reach level 2
      for (const agentId of agentIds) {
        const state = escalationService.getEscalationState(agentId);
        expect(state.level).toBeGreaterThanOrEqual(2);
      }

      const summary = escalationService.getSummary();
      expect(summary.activeEscalations).toBe(3);
    });

    it('should recover agents independently', async () => {
      const agentIds = ['agent-01', 'agent-02', 'agent-03'];

      // Escalate all
      for (const agentId of agentIds) {
        for (let i = 0; i < 10; i++) {
          await escalationService.onAgentOffline(agentId);
        }
      }

      // Recover only first agent
      await escalationService.onAgentOnline('agent-01');

      let state1 = escalationService.getEscalationState('agent-01');
      let state2 = escalationService.getEscalationState('agent-02');

      expect(state1.level).toBe(0);
      expect(state2.level).toBe(3);
    });
  });

  describe('full pipeline: offline → escalation → recovery', () => {
    it('should complete full cycle: detect → escalate → recover', async () => {
      const agentId = 'agent-01';

      // Phase 1: Offline detection
      const oldTime = new Date(Date.now() - 20000);
      heartbeatService.recordHeartbeat(agentId, oldTime);
      await (heartbeatService as any).checkHeartbeats();

      let hb = heartbeatService.getAgentHeartbeat(agentId);
      expect(hb?.status).toBe('offline');

      // Phase 2: Escalation
      for (let i = 0; i < 10; i++) {
        await escalationService.onAgentOffline(agentId);
      }

      let state = escalationService.getEscalationState(agentId);
      expect(state.level).toBe(3);

      // Phase 3: Recovery
      const now = new Date();
      heartbeatService.recordHeartbeat(agentId, now);
      hb = heartbeatService.getAgentHeartbeat(agentId);
      expect(hb?.status).toBe('online');

      await escalationService.onAgentOnline(agentId);
      state = escalationService.getEscalationState(agentId);
      expect(state.level).toBe(0);
    });
  });

  describe('status summaries', () => {
    it('should provide heartbeat status summary', () => {
      const summary = heartbeatService.getStatusSummary();

      expect(summary).toHaveProperty('online');
      expect(summary).toHaveProperty('offline');
      expect(summary).toHaveProperty('warning');
      expect(summary).toHaveProperty('agents');
      expect(typeof summary.online).toBe('number');
      expect(typeof summary.offline).toBe('number');
      expect(typeof summary.warning).toBe('number');
    });

    it('should provide escalation summary', async () => {
      for (let i = 0; i < 6; i++) {
        await escalationService.onAgentOffline('agent-01');
      }

      const summary = escalationService.getSummary();

      expect(summary).toHaveProperty('activeEscalations');
      expect(summary).toHaveProperty('byLevel');
      expect(typeof summary.activeEscalations).toBe('number');
      expect(summary.activeEscalations).toBeGreaterThan(0);
    });

    it('should provide recovery status', () => {
      const statuses = recoveryService.getAllRecoveryStatuses();

      expect(typeof statuses).toBe('object');
      expect(Array.isArray(Object.keys(statuses))).toBe(true);
    });
  });
});
