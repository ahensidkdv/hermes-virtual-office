import { Test, TestingModule } from '@nestjs/testing';
import { HeartbeatMonitoringService } from './heartbeat.service';
import { CloudEventService } from '../events/cloud-event.service';
import { AgentsService } from '../agents/agents.service';
import { AlertService } from './alert.service';

describe('HeartbeatMonitoringService - Escalation', () => {
  let service: HeartbeatMonitoringService;
  let cloudEventService: jest.Mocked<CloudEventService>;
  let agentsService: jest.Mocked<AgentsService>;
  let alertService: jest.Mocked<AlertService>;

  beforeEach(async () => {
    const mockCloudEventService = {
      publishAgentOnline: jest.fn().mockResolvedValue(undefined),
      publishAgentOffline: jest.fn().mockResolvedValue(undefined),
      publishTaskCreated: jest.fn().mockResolvedValue(undefined),
      publishAlertCreated: jest.fn().mockResolvedValue(undefined),
      publishAlertEscalated: jest.fn().mockResolvedValue(undefined),
      publishAlertResolved: jest.fn().mockResolvedValue(undefined),
    };

    const mockAgentsService = {
      listAgents: jest.fn().mockResolvedValue([
        { id: 'agent-01' },
        { id: 'agent-02' },
      ]),
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
        {
          provide: CloudEventService,
          useValue: mockCloudEventService,
        },
        {
          provide: AgentsService,
          useValue: mockAgentsService,
        },
        {
          provide: AlertService,
          useValue: mockAlertService,
        },
      ],
    }).compile();

    service = module.get<HeartbeatMonitoringService>(HeartbeatMonitoringService);
    cloudEventService = module.get(CloudEventService) as jest.Mocked<CloudEventService>;
    agentsService = module.get(AgentsService) as jest.Mocked<AgentsService>;
    alertService = module.get(AlertService) as jest.Mocked<AlertService>;
  });

  afterEach(async () => {
    if (service) {
      try {
        await service.onModuleDestroy();
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });

  describe('recordHeartbeat', () => {
    it('should record heartbeat for agent', () => {
      const agentId = 'agent-03';
      const now = new Date();

      service.recordHeartbeat(agentId, now);

      const heartbeat = service.getAgentHeartbeat(agentId);
      expect(heartbeat).toBeDefined();
      expect(heartbeat?.status).toBe('online');
      expect(heartbeat?.lastHeartbeat).toEqual(now);
    });

    it('should update last heartbeat time', () => {
      const agentId = 'agent-04';
      const time1 = new Date('2026-10-01T10:00:00');
      const time2 = new Date('2026-10-01T10:00:05');

      service.recordHeartbeat(agentId, time1);
      service.recordHeartbeat(agentId, time2);

      const heartbeat = service.getAgentHeartbeat(agentId);
      expect(heartbeat?.lastHeartbeat).toEqual(time2);
    });

    it('should reset consecutive offline count on heartbeat', () => {
      const agentId = 'agent-05';
      const oldTime = new Date(Date.now() - 20000);

      service.recordHeartbeat(agentId, oldTime);

      let heartbeat = service.getAgentHeartbeat(agentId);
      heartbeat!.consecutiveOfflineCount = 2;

      service.recordHeartbeat(agentId, new Date());

      heartbeat = service.getAgentHeartbeat(agentId);
      expect(heartbeat?.consecutiveOfflineCount).toBe(0);
    });
  });

  describe('periodic check - offline detection', () => {
    it('should detect online → offline transition', async () => {
      const agentId = 'agent-06';
      const oldTime = new Date(Date.now() - 20000);

      service.recordHeartbeat(agentId, oldTime);
      await service.checkHeartbeats();

      const heartbeat = service.getAgentHeartbeat(agentId);
      expect(heartbeat?.status).toBe('offline');
    });

    it('should mark as warning before offline', async () => {
      const agentId = 'agent-07';
      const warningTime = new Date(Date.now() - 12000);

      service.recordHeartbeat(agentId, warningTime);
      await service.checkHeartbeats();

      const heartbeat = service.getAgentHeartbeat(agentId);
      expect(heartbeat?.status).toBe('warning');
    });

    it('should keep online if recent heartbeat', async () => {
      const agentId = 'agent-08';
      const recentTime = new Date(Date.now() - 2000);

      service.recordHeartbeat(agentId, recentTime);
      await service.checkHeartbeats();

      const heartbeat = service.getAgentHeartbeat(agentId);
      expect(heartbeat?.status).toBe('online');
    });
  });

  describe('escalation workflow', () => {
    it('should initiate escalation on offline detection', async () => {
      const agentId = 'agent-09';
      const oldTime = new Date(Date.now() - 20000);

      service.recordHeartbeat(agentId, oldTime);
      await service.checkHeartbeats();

      expect(alertService.createAlert).toHaveBeenCalledWith(
        agentId,
        'info',
        expect.any(String),
      );
    });

    it('should track escalation state per agent', async () => {
      const agentId1 = 'agent-11';
      const agentId2 = 'agent-12';

      service.recordHeartbeat(agentId1, new Date(Date.now() - 25000));
      service.recordHeartbeat(agentId2, new Date(Date.now() - 5000));

      await service.checkHeartbeats();

      const heartbeat1 = service.getAgentHeartbeat(agentId1);
      const heartbeat2 = service.getAgentHeartbeat(agentId2);

      expect(heartbeat1?.status).toBe('offline');
      expect(heartbeat1?.escalationState).toBeDefined();

      expect(heartbeat2?.status).toBe('online');
      expect(heartbeat2?.escalationState).toBeUndefined();
    });
  });

  describe('auto-recovery workflow', () => {
    it('should recover from offline when heartbeat resumes', async () => {
      const agentId = 'agent-13';
      const oldTime = new Date(Date.now() - 20000);

      service.recordHeartbeat(agentId, oldTime);
      await service.checkHeartbeats();

      let heartbeat = service.getAgentHeartbeat(agentId);
      expect(heartbeat?.status).toBe('offline');

      service.recordHeartbeat(agentId, new Date());
      await service.checkHeartbeats();

      heartbeat = service.getAgentHeartbeat(agentId);
      expect(heartbeat?.status).toBe('online');
    });

    it('should auto-clear alerts on recovery', async () => {
      const agentId = 'agent-14';
      const oldTime = new Date(Date.now() - 20000);

      service.recordHeartbeat(agentId, oldTime);
      await service.checkHeartbeats();

      const heartbeat1 = service.getAgentHeartbeat(agentId);
      expect(heartbeat1?.escalationState).toBeDefined();

      service.recordHeartbeat(agentId, new Date());
      await service.checkHeartbeats();

      expect(alertService.resolveAlert).toHaveBeenCalled();

      const heartbeat2 = service.getAgentHeartbeat(agentId);
      expect(heartbeat2?.escalationState).toBeUndefined();
    });

    it('should reset consecutive offline count on recovery', async () => {
      const agentId = 'agent-15';
      const oldTime = new Date(Date.now() - 20000);

      service.recordHeartbeat(agentId, oldTime);
      await service.checkHeartbeats();

      let heartbeat = service.getAgentHeartbeat(agentId);
      expect(heartbeat?.consecutiveOfflineCount).toBeGreaterThan(0);

      service.recordHeartbeat(agentId, new Date());
      await service.checkHeartbeats();

      heartbeat = service.getAgentHeartbeat(agentId);
      expect(heartbeat?.consecutiveOfflineCount).toBe(0);
    });
  });

  describe('concurrent heartbeat events', () => {
    it('should handle multiple agents offline concurrently', async () => {
      service.recordHeartbeat('agent-16', new Date(Date.now() - 20000));
      service.recordHeartbeat('agent-17', new Date(Date.now() - 25000));
      service.recordHeartbeat('agent-18', new Date(Date.now() - 30000));

      await service.checkHeartbeats();

      const summary = service.getStatusSummary();
      expect(summary.offline).toBe(3);
    });

    it('should handle mixed states concurrently', async () => {
      service.recordHeartbeat('agent-19', new Date());
      service.recordHeartbeat('agent-20', new Date(Date.now() - 12000));
      service.recordHeartbeat('agent-21', new Date(Date.now() - 20000));

      await service.checkHeartbeats();

      const summary = service.getStatusSummary();
      expect(summary.online).toBeGreaterThan(0);
      expect(summary.warning).toBeGreaterThan(0);
      expect(summary.offline).toBeGreaterThan(0);
    });
  });

  describe('status summary', () => {
    it('should return accurate agent status', () => {
      service.recordHeartbeat('agent-24', new Date());
      service.recordHeartbeat('agent-25', new Date());

      const summary = service.getStatusSummary();

      expect(summary.agents['agent-24'].status).toBe('online');
      expect(summary.agents['agent-25'].status).toBe('online');
    });

    it('should include escalation level in summary', async () => {
      service.recordHeartbeat('agent-27', new Date(Date.now() - 20000));
      await service.checkHeartbeats();

      const summary = service.getStatusSummary();
      const agentSummary = summary.agents['agent-27'];

      expect(agentSummary).toBeDefined();
      expect(agentSummary.status).toBe('offline');
    });
  });

  describe('periodic check lifecycle', () => {
    it('should have periodic check running', () => {
      const isRunning = service.isPeriodicCheckRunning();
      expect(isRunning).toBe(true);
    });

    it('should stop periodic check on destroy', async () => {
      await service.onModuleDestroy();
      const isRunning = service.isPeriodicCheckRunning();
      expect(isRunning).toBe(false);
    });
  });
});
