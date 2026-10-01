import { Test, TestingModule } from '@nestjs/testing';
import { PeriodicHeartbeatCheckService } from './periodic-heartbeat-check.service';
import { CloudEventService } from '../events/cloud-event.service';
import { AgentsService } from '../agents/agents.service';

describe('PeriodicHeartbeatCheckService', () => {
  let service: PeriodicHeartbeatCheckService;
  let cloudEventService: jest.Mocked<CloudEventService>;
  let agentsService: jest.Mocked<AgentsService>;

  beforeEach(async () => {
    const mockCloudEventService = {
      publishAgentOnline: jest.fn().mockResolvedValue(undefined),
      publishAgentOffline: jest.fn().mockResolvedValue(undefined),
    };

    const mockAgentsService = {
      listAgents: jest.fn().mockResolvedValue([
        { id: 'agent-01', status: 'idle' },
        { id: 'agent-02', status: 'idle' },
      ]),
      getAgent: jest.fn().mockResolvedValue({ id: 'agent-01', status: 'idle' }),
      updateAgentStatus: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PeriodicHeartbeatCheckService,
        { provide: CloudEventService, useValue: mockCloudEventService },
        { provide: AgentsService, useValue: mockAgentsService },
      ],
    }).compile();

    service = module.get<PeriodicHeartbeatCheckService>(PeriodicHeartbeatCheckService);
    cloudEventService = module.get(CloudEventService) as jest.Mocked<CloudEventService>;
    agentsService = module.get(AgentsService) as jest.Mocked<AgentsService>;

    // Mock Redis publish
    (service as any).redis.publish = jest.fn().mockResolvedValue(1);
  });

  afterEach(async () => {
    if (service) {
      try {
        await service.stop();
        await service.onModuleDestroy();
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });

  describe('lifecycle', () => {
    it('should start polling', async () => {
      await service.start();

      const status = service.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.checkIntervalMs).toBe(5000);
    });

    it('should stop polling', async () => {
      await service.start();
      await service.stop();

      const status = service.getStatus();
      expect(status.isRunning).toBe(false);
    });

    it('should not start twice', async () => {
      await service.start();
      await service.start(); // Should be no-op

      const status = service.getStatus();
      expect(status.isRunning).toBe(true);
    });

    it('should handle stop when not running', async () => {
      await expect(service.stop()).resolves.not.toThrow();
    });
  });

  describe('polling', () => {
    it('should track last check timestamp', async () => {
      await service.start();

      // Wait for first check
      await new Promise((resolve) => setTimeout(resolve, 100));

      const lastCheck = service.getLastCheckTime('agent-01');
      expect(lastCheck).toBeDefined();
      expect(lastCheck instanceof Date).toBe(true);

      await service.stop();
    });

    it('should call agentsService.listAgents on each check', async () => {
      await service.start();

      // Wait for multiple checks (2x interval)
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(agentsService.listAgents).toHaveBeenCalled();
      const callCount = agentsService.listAgents.mock.calls.length;
      expect(callCount).toBeGreaterThan(0);

      await service.stop();
    });

    it('should handle check errors gracefully', async () => {
      agentsService.listAgents.mockRejectedValueOnce(new Error('DB error'));

      await service.start();

      // Wait for check to fail
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Service should still be running
      const status = service.getStatus();
      expect(status.isRunning).toBe(true);

      await service.stop();
    });
  });

  describe('status', () => {
    it('should return polling status', async () => {
      const status = service.getStatus();

      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('checkIntervalMs');
      expect(status).toHaveProperty('lastCheckTimestamps');
      expect(status.isRunning).toBe(false);
    });

    it('should return last check time for agent', async () => {
      const now = new Date();
      // Simulate a check
      agentsService.listAgents.mockResolvedValueOnce([{ id: 'agent-test', status: 'idle' }]);
      agentsService.getAgent.mockResolvedValueOnce({ id: 'agent-test', status: 'idle' });

      await service.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const lastCheck = service.getLastCheckTime('agent-test');
      expect(lastCheck).toBeDefined();
      if (lastCheck) {
        expect(lastCheck.getTime()).toBeGreaterThanOrEqual(now.getTime() - 100);
      }

      await service.stop();
    });
  });
});
