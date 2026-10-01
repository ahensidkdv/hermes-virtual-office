import { Test, TestingModule } from '@nestjs/testing';
import { AlertService } from './alert.service';
import { CloudEventService } from '../events/cloud-event.service';

describe('AlertService - Logic (No Redis)', () => {
  let service: AlertService;
  let cloudEventService: jest.Mocked<CloudEventService>;

  beforeEach(async () => {
    const mockCloudEventService = {
      publishAlertCreated: jest.fn().mockResolvedValue(undefined),
      publishAlertEscalated: jest.fn().mockResolvedValue(undefined),
      publishAlertResolved: jest.fn().mockResolvedValue(undefined),
    };

    // Create service with mocked redis
    const mockRedis = {
      setex: jest.fn().mockResolvedValue(undefined),
      lpush: jest.fn().mockResolvedValue(undefined),
      publish: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    };

    // Mock require for ioredis
    jest.mock('ioredis', () => {
      return jest.fn(() => mockRedis);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertService,
        {
          provide: CloudEventService,
          useValue: mockCloudEventService,
        },
      ],
    }).compile();

    service = module.get<AlertService>(AlertService);
    cloudEventService = module.get(CloudEventService) as jest.Mocked<CloudEventService>;
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

  describe('Alert Creation', () => {
    it('should track alert in memory', async () => {
      const agentId = 'agent-01';
      const alertId = await service.createAlert(agentId, 'info', 'Test alert');

      expect(alertId).toBeDefined();
      const alerts = service.getAgentAlerts(agentId);
      expect(alerts.length).toBeGreaterThan(0);
    });

    it('should create alert with correct level', async () => {
      const agentId = 'agent-02';
      const alertId = await service.createAlert(agentId, 'warning', 'Warning alert');

      const alerts = service.getAgentAlerts(agentId);
      expect(alerts[0].level).toBe('warning');
    });
  });

  describe('Alert Escalation', () => {
    it('should escalate from info to warning', async () => {
      const agentId = 'agent-03';
      const alertId = await service.createAlert(agentId, 'info', 'Test');

      await service.escalateAlert(alertId);

      const alerts = service.getAgentAlerts(agentId);
      expect(alerts[0].level).toBe('warning');
      expect(alerts[0].escalationCount).toBe(1);
    });

    it('should escalate from warning to critical', async () => {
      const agentId = 'agent-04';
      const alertId = await service.createAlert(agentId, 'warning', 'Test');

      await service.escalateAlert(alertId);

      const alerts = service.getAgentAlerts(agentId);
      expect(alerts[0].level).toBe('critical');
    });

    it('should not escalate beyond critical', async () => {
      const agentId = 'agent-05';
      const alertId = await service.createAlert(agentId, 'critical', 'Test');

      await service.escalateAlert(alertId);

      const alerts = service.getAgentAlerts(agentId);
      expect(alerts[0].level).toBe('critical');
    });

    it('should increment escalation count', async () => {
      const agentId = 'agent-06';
      const alertId = await service.createAlert(agentId, 'info', 'Test');

      await service.escalateAlert(alertId);
      await service.escalateAlert(alertId);

      const alerts = service.getAgentAlerts(agentId);
      expect(alerts[0].escalationCount).toBe(2);
    });
  });

  describe('Alert Resolution', () => {
    it('should resolve active alert', async () => {
      const agentId = 'agent-07';
      const alertId = await service.createAlert(agentId, 'warning', 'Test');

      let alerts = service.getAgentAlerts(agentId);
      expect(alerts.length).toBe(1);

      await service.resolveAlert(alertId);

      alerts = service.getAgentAlerts(agentId);
      expect(alerts.length).toBe(0);
    });

    it('should mark alert as resolved in history', async () => {
      const agentId = 'agent-08';
      const alertId = await service.createAlert(agentId, 'critical', 'Test');

      await service.resolveAlert(alertId);

      const history = service.getAlertHistory();
      const resolved = history.find((a) => a.id === alertId);
      expect(resolved?.resolvedAt).toBeDefined();
    });
  });

  describe('Alert Queries', () => {
    it('should get highest alert level for agent', async () => {
      const agentId = 'agent-09';
      await service.createAlert(agentId, 'info', 'Alert 1');
      await service.createAlert(agentId, 'warning', 'Alert 2');
      await service.createAlert(agentId, 'critical', 'Alert 3');

      const level = service.getHighestAlertLevel(agentId);
      expect(level).toBe('critical');
    });

    it('should return null for agent with no alerts', () => {
      const level = service.getHighestAlertLevel('unknown-agent');
      expect(level).toBeNull();
    });

    it('should get all active alerts', async () => {
      await service.createAlert('agent-10', 'info', 'Alert 1');
      await service.createAlert('agent-11', 'warning', 'Alert 2');

      const active = service.getAllActiveAlerts();
      expect(active.length).toBeGreaterThanOrEqual(2);
    });

    it('should summarize alerts by level', async () => {
      await service.createAlert('agent-12', 'info', 'Alert 1');
      await service.createAlert('agent-13', 'warning', 'Alert 2');
      await service.createAlert('agent-13', 'critical', 'Alert 3');

      const summary = service.getAlertSummary();

      expect(summary.total).toBeGreaterThanOrEqual(3);
      expect(summary.byLevel.info).toBeGreaterThanOrEqual(1);
      expect(summary.byLevel.warning).toBeGreaterThanOrEqual(1);
      expect(summary.byLevel.critical).toBeGreaterThanOrEqual(1);
    });
  });

  describe('CloudEvent Publishing', () => {
    it('should publish alert.created event', async () => {
      const agentId = 'agent-14';
      await service.createAlert(agentId, 'info', 'Test');

      expect(cloudEventService.publishAlertCreated).toHaveBeenCalled();
    });

    it('should publish alert.escalated event', async () => {
      const agentId = 'agent-15';
      const alertId = await service.createAlert(agentId, 'info', 'Test');

      await service.escalateAlert(alertId);

      expect(cloudEventService.publishAlertEscalated).toHaveBeenCalled();
    });

    it('should publish alert.resolved event', async () => {
      const agentId = 'agent-16';
      const alertId = await service.createAlert(agentId, 'warning', 'Test');

      await service.resolveAlert(alertId);

      expect(cloudEventService.publishAlertResolved).toHaveBeenCalled();
    });
  });

  describe('Alert History', () => {
    it('should maintain alert history', async () => {
      await service.createAlert('agent-17', 'info', 'Alert 1');
      await service.createAlert('agent-18', 'warning', 'Alert 2');

      const history = service.getAlertHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);
    });

    it('should cap history at max size', async () => {
      // Create many alerts to test history limit
      for (let i = 0; i < 100; i++) {
        await service.createAlert(`agent-${i}`, 'info', `Alert ${i}`);
      }

      const history = service.getAlertHistory();
      expect(history.length).toBeLessThanOrEqual(1000);
    });
  });
});
