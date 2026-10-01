import { Test, TestingModule } from '@nestjs/testing';
import { AuditTrailService } from './audit-trail.service';

describe('AuditTrailService', () => {
  let service: AuditTrailService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditTrailService],
    }).compile();

    service = module.get<AuditTrailService>(AuditTrailService);
  });

  afterEach(async () => {
    try {
      await service.clearAuditTrail('task-1');
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('logReadAccess()', () => {
    it('should log read access', async () => {
      await expect(
        service.logReadAccess('task-1', 'key1', 'agent-1'),
      ).resolves.not.toThrow();
    });

    it('should log multiple read accesses', async () => {
      await service.logReadAccess('task-1', 'key1', 'agent-1');
      await service.logReadAccess('task-1', 'key1', 'agent-2');

      const entries = await service.getAuditTrail('task-1');
      expect(entries.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('logWriteAccess()', () => {
    it('should log write access', async () => {
      await expect(
        service.logWriteAccess('task-1', 'key1', 'agent-1', 0),
      ).resolves.not.toThrow();
    });

    it('should include version in write log', async () => {
      await service.logWriteAccess('task-1', 'key1', 'agent-1', 1);

      const entries = await service.getAuditTrail('task-1');
      const writeEntry = entries.find((e) => e.operation === 'write');
      expect(writeEntry).toBeDefined();
      expect(writeEntry?.version).toBe(1);
    });

    it('should truncate large values', async () => {
      const largeValue = 'x'.repeat(1000);
      await service.logWriteAccess('task-1', 'key1', 'agent-1', 0, largeValue);

      const entries = await service.getAuditTrail('task-1');
      const writeEntry = entries.find((e) => e.operation === 'write');
      expect(writeEntry?.value?.length).toBeLessThan(200);
    });
  });

  describe('logDeleteAccess()', () => {
    it('should log delete access', async () => {
      await expect(
        service.logDeleteAccess('task-1', 'key1', 'agent-1'),
      ).resolves.not.toThrow();
    });

    it('should include delete in audit trail', async () => {
      await service.logDeleteAccess('task-1', 'key1', 'agent-1');

      const entries = await service.getAuditTrail('task-1');
      const deleteEntry = entries.find((e) => e.operation === 'delete');
      expect(deleteEntry).toBeDefined();
    });
  });

  describe('logConflict()', () => {
    it('should log conflict', async () => {
      await expect(
        service.logConflict('task-1', 'key1', 'agent-1', 0, 1),
      ).resolves.not.toThrow();
    });

    it('should include conflict metadata', async () => {
      await service.logConflict('task-1', 'key1', 'agent-1', 0, 1, {
        retryCount: 1,
      });

      const entries = await service.getAuditTrail('task-1');
      const conflictEntry = entries.find((e) => e.operation === 'conflict');
      expect(conflictEntry).toBeDefined();
      expect(conflictEntry?.baseVersion).toBe(0);
      expect(conflictEntry?.currentVersion).toBe(1);
      expect(conflictEntry?.metadata?.retryCount).toBe(1);
    });

    it('should increment agent conflict counter', async () => {
      await service.logConflict('task-1', 'key1', 'agent-1', 0, 1);

      const stats = await service.getAgentStats('agent-1');
      expect(stats.conflictCount).toBeGreaterThan(0);
    });
  });

  describe('getAuditTrail()', () => {
    it('should return audit entries for task', async () => {
      await service.logReadAccess('task-1', 'key1', 'agent-1');
      await service.logWriteAccess('task-1', 'key1', 'agent-1', 0);

      const entries = await service.getAuditTrail('task-1');
      expect(entries.length).toBeGreaterThanOrEqual(2);
    });

    it('should return entries in reverse chronological order', async () => {
      await service.logReadAccess('task-1', 'key1', 'agent-1');
      await new Promise((resolve) => setTimeout(resolve, 10));
      await service.logWriteAccess('task-1', 'key1', 'agent-1', 0);

      const entries = await service.getAuditTrail('task-1');
      if (entries.length >= 2) {
        const first = new Date(entries[0].timestamp);
        const second = new Date(entries[1].timestamp);
        expect(first.getTime()).toBeGreaterThanOrEqual(second.getTime());
      }
    });

    it('should filter by agent', async () => {
      await service.logReadAccess('task-1', 'key1', 'agent-1');
      await service.logReadAccess('task-1', 'key1', 'agent-2');

      const entries = await service.getAuditTrail('task-1', { agentId: 'agent-1' });
      for (const entry of entries) {
        expect(entry.agentId).toBe('agent-1');
      }
    });

    it('should filter by operation', async () => {
      await service.logReadAccess('task-1', 'key1', 'agent-1');
      await service.logWriteAccess('task-1', 'key1', 'agent-1', 0);

      const entries = await service.getAuditTrail('task-1', { operation: 'read' });
      for (const entry of entries) {
        expect(entry.operation).toBe('read');
      }
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await service.logReadAccess('task-1', 'key1', 'agent-1');
      }

      const entries = await service.getAuditTrail('task-1', { limit: 5 });
      expect(entries.length).toBeLessThanOrEqual(5);
    });

    it('should filter by time range', async () => {
      const startTime = new Date();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await service.logReadAccess('task-1', 'key1', 'agent-1');
      const endTime = new Date();

      const entries = await service.getAuditTrail('task-1', {
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
      });

      for (const entry of entries) {
        const entryTime = new Date(entry.timestamp);
        expect(entryTime.getTime()).toBeGreaterThanOrEqual(startTime.getTime());
        expect(entryTime.getTime()).toBeLessThanOrEqual(endTime.getTime());
      }
    });
  });

  describe('getAuditForKey()', () => {
    it('should return audit entries for specific key', async () => {
      await service.logReadAccess('task-1', 'key1', 'agent-1');
      await service.logReadAccess('task-1', 'key2', 'agent-1');

      const entries = await service.getAuditForKey('task-1', 'key1');
      for (const entry of entries) {
        expect(entry.key).toBe('key1');
      }
    });

    it('should respect limit for key audit', async () => {
      for (let i = 0; i < 10; i++) {
        await service.logReadAccess('task-1', 'key1', 'agent-1');
      }

      const entries = await service.getAuditForKey('task-1', 'key1', 5);
      expect(entries.length).toBeLessThanOrEqual(5);
    });
  });

  describe('getConflictsForAgent()', () => {
    it('should return conflicts for agent', async () => {
      await service.logConflict('task-1', 'key1', 'agent-1', 0, 1);
      await service.logConflict('task-1', 'key2', 'agent-1', 0, 1);

      const conflicts = await service.getConflictsForAgent('agent-1');
      for (const entry of conflicts) {
        expect(entry.operation).toBe('conflict');
        expect(entry.agentId).toBe('agent-1');
      }
    });

    it('should filter out non-conflict operations', async () => {
      await service.logReadAccess('task-1', 'key1', 'agent-1');
      await service.logConflict('task-1', 'key2', 'agent-1', 0, 1);

      const conflicts = await service.getConflictsForAgent('agent-1');
      for (const entry of conflicts) {
        expect(entry.operation).toBe('conflict');
      }
    });
  });

  describe('getAgentStats()', () => {
    it('should return agent statistics', async () => {
      await service.logReadAccess('task-1', 'key1', 'agent-1');
      await service.logWriteAccess('task-1', 'key1', 'agent-1', 0);

      const stats = await service.getAgentStats('agent-1');
      expect(stats.totalOperations).toBeGreaterThanOrEqual(2);
      expect(stats.operationsByType).toBeDefined();
      expect(stats.conflictCount).toBeDefined();
    });

    it('should count operations by type', async () => {
      await service.logReadAccess('task-1', 'key1', 'agent-1');
      await service.logReadAccess('task-1', 'key1', 'agent-1');
      await service.logWriteAccess('task-1', 'key1', 'agent-1', 0);

      const stats = await service.getAgentStats('agent-1');
      expect(stats.operationsByType.read).toBeGreaterThanOrEqual(2);
      expect(stats.operationsByType.write).toBeGreaterThanOrEqual(1);
    });

    it('should track last activity', async () => {
      await service.logReadAccess('task-1', 'key1', 'agent-1');

      const stats = await service.getAgentStats('agent-1');
      expect(stats.lastActivity).toBeDefined();
      expect(new Date(stats.lastActivity!).getTime()).toBeGreaterThan(0);
    });
  });

  describe('clearAuditTrail()', () => {
    it('should clear audit trail for task', async () => {
      await service.logReadAccess('task-1', 'key1', 'agent-1');
      await service.logReadAccess('task-1', 'key1', 'agent-1');

      await service.clearAuditTrail('task-1');

      const entries = await service.getAuditTrail('task-1');
      expect(entries.length).toBe(0);
    });
  });

  describe('getOperationStats()', () => {
    it('should count operations by type', async () => {
      await service.logReadAccess('task-1', 'key1', 'agent-1');
      await service.logReadAccess('task-1', 'key1', 'agent-1');
      await service.logWriteAccess('task-1', 'key1', 'agent-1', 0);
      await service.logDeleteAccess('task-1', 'key1', 'agent-1');

      const stats = await service.getOperationStats('task-1');
      expect(stats.read).toBeGreaterThanOrEqual(2);
      expect(stats.write).toBeGreaterThanOrEqual(1);
      expect(stats.delete).toBeGreaterThanOrEqual(1);
    });

    it('should return zero for non-existent task', async () => {
      const stats = await service.getOperationStats('non-existent-task');
      expect(stats.read).toBe(0);
      expect(stats.write).toBe(0);
      expect(stats.delete).toBe(0);
      expect(stats.conflict).toBe(0);
    });
  });
});
