import { Test, TestingModule } from '@nestjs/testing';
import { AlertEscalationService } from './alert-escalation.service';
import { CloudEventService } from '../events/cloud-event.service';
import { AgentsService } from '../agents/agents.service';
import { AlertService } from './alert.service';

describe('AlertEscalationService', () => {
  let service: AlertEscalationService;
  let cloudEventService: jest.Mocked<CloudEventService>;
  let agentsService: jest.Mocked<AgentsService>;
  let alertService: jest.Mocked<AlertService>;

  beforeEach(async () => {
    const mockCloudEventService = {
      publishAgentOnline: jest.fn().mockResolvedValue(undefined),
      publishAgentOffline: jest.fn().mockResolvedValue(undefined),
      publishAlertEscalated: jest.fn().mockResolvedValue(undefined),
    };

    const mockAgentsService = {
      listAgents: jest.fn().mockResolvedValue([]),
      updateAgentStatus: jest.fn().mockResolvedValue(undefined),
    };

    const mockAlertService = {
      createAlert: jest.fn()
        .mockResolvedValueOnce('alert-001')
        .mockResolvedValueOnce('alert-002')
        .mockResolvedValueOnce('alert-003')
        .mockResolvedValue('alert-999'),
      resolveAlert: jest.fn().mockResolvedValue(undefined),
      getAgentAlerts: jest.fn().mockReturnValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertEscalationService,
        { provide: CloudEventService, useValue: mockCloudEventService },
        { provide: AgentsService, useValue: mockAgentsService },
        { provide: AlertService, useValue: mockAlertService },
      ],
    }).compile();

    service = module.get<AlertEscalationService>(AlertEscalationService);
    cloudEventService = module.get(CloudEventService) as jest.Mocked<CloudEventService>;
    agentsService = module.get(AgentsService) as jest.Mocked<AgentsService>;
    alertService = module.get(AlertService) as jest.Mocked<AlertService>;

    // Mock Redis publish method
    (service as any).redis.publish = jest.fn().mockResolvedValue(1);
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

  describe('alert level calculation', () => {
    it('should return 0 for count < 3', () => {
      expect(service.getAlertLevel(0)).toBe(0);
      expect(service.getAlertLevel(1)).toBe(0);
      expect(service.getAlertLevel(2)).toBe(0);
    });

    it('should return 1 for count >= 3', () => {
      expect(service.getAlertLevel(3)).toBe(1);
      expect(service.getAlertLevel(4)).toBe(1);
      expect(service.getAlertLevel(5)).toBe(1);
    });

    it('should return 2 for count >= 6', () => {
      expect(service.getAlertLevel(6)).toBe(2);
      expect(service.getAlertLevel(7)).toBe(2);
      expect(service.getAlertLevel(9)).toBe(2);
    });

    it('should return 3 for count >= 10', () => {
      expect(service.getAlertLevel(10)).toBe(3);
      expect(service.getAlertLevel(15)).toBe(3);
      expect(service.getAlertLevel(100)).toBe(3);
    });
  });

  describe('escalation flow', () => {
    it('should track offline count and escalate', async () => {
      const agentId = 'agent-test';

      // Trigger 10 offline events
      for (let i = 0; i < 10; i++) {
        await service.onAgentOffline(agentId);
      }

      const state = service.getEscalationState(agentId);
      expect(state.offlineCount).toBe(10);
      expect(state.level).toBeGreaterThan(0);
    });

    it('should escalate to level 3 with enough offline events', async () => {
      const agentId = 'agent-test';

      // Trigger 10+ offline events to reach level 3
      for (let i = 0; i < 11; i++) {
        await service.onAgentOffline(agentId);
      }

      const state = service.getEscalationState(agentId);
      expect(state.level).toBe(3);
    });
  });

  describe('recovery', () => {
    it('should reset state on agent online', async () => {
      const agentId = 'agent-test';

      // Reach level 2
      for (let i = 0; i < 6; i++) {
        await service.onAgentOffline(agentId);
      }

      let state = service.getEscalationState(agentId);
      const initialLevel = state.level;
      expect(initialLevel).toBeGreaterThan(0);

      // Recovery
      await service.onAgentOnline(agentId);

      state = service.getEscalationState(agentId);
      expect(state.level).toBe(0);
      expect(state.offlineCount).toBe(0);
    });

    it('should publish online event on recovery', async () => {
      const agentId = 'agent-test';

      // Reach level 2
      for (let i = 0; i < 6; i++) {
        await service.onAgentOffline(agentId);
      }

      // Recovery
      await service.onAgentOnline(agentId);

      // Should publish online event
      expect(cloudEventService.publishAgentOnline).toHaveBeenCalledWith(agentId);
    });
  });

  describe('cooldown', () => {
    it('should track offline counts', async () => {
      const agentId = 'agent-test';

      for (let i = 0; i < 5; i++) {
        await service.onAgentOffline(agentId);
      }

      const state = service.getEscalationState(agentId);
      expect(state.offlineCount).toBe(5);
    });
  });

  describe('summary', () => {
    it('should return summary of escalations', async () => {
      // Reach level 1
      for (let i = 0; i < 3; i++) {
        await service.onAgentOffline('agent-01');
      }

      // Reach level 2
      for (let i = 0; i < 6; i++) {
        await service.onAgentOffline('agent-02');
      }

      const summary = service.getSummary();
      expect(summary.activeEscalations).toBeGreaterThanOrEqual(1);
      expect(summary).toHaveProperty('byLevel');
    });

    it('should not count resolved escalations', async () => {
      // Reach level 1
      for (let i = 0; i < 3; i++) {
        await service.onAgentOffline('agent-01');
      }

      let summary = service.getSummary();
      const initialCount = summary.activeEscalations;

      // Recover
      await service.onAgentOnline('agent-01');

      summary = service.getSummary();
      expect(summary.activeEscalations).toBeLessThan(initialCount);
    });
  });

  describe('state retrieval', () => {
    it('should return escalation state for agent', async () => {
      const agentId = 'agent-test';

      for (let i = 0; i < 6; i++) {
        await service.onAgentOffline(agentId);
      }

      const state = service.getEscalationState(agentId);
      expect(state.offlineCount).toBe(6);
      expect(state.level).toBeGreaterThan(1);
    });

    it('should return all escalation states', async () => {
      for (let i = 0; i < 3; i++) {
        await service.onAgentOffline('agent-01');
      }
      for (let i = 0; i < 6; i++) {
        await service.onAgentOffline('agent-02');
      }

      const states = service.getAllEscalationStates();
      expect(Object.keys(states).length).toBe(2);
      expect(states['agent-01'].level).toBeGreaterThan(0);
      expect(states['agent-02'].level).toBeGreaterThan(0);
    });
  });
});
