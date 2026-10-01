import { Test, TestingModule } from '@nestjs/testing';
import { ConflictDetectionService, ConflictType } from './conflict-detection.service';

describe('ConflictDetectionService', () => {
  let service: ConflictDetectionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ConflictDetectionService],
    }).compile();

    service = module.get<ConflictDetectionService>(ConflictDetectionService);
  });

  afterEach(async () => {
    try {
      await service.resetMetrics();
    } catch (error) {
      // Ignore reset errors
    }
  });

  describe('detectConflict()', () => {
    it('should detect conflict when versions differ', () => {
      const result = service.detectConflict(0, 1);
      expect(result).toBe(true);
    });

    it('should not detect conflict when versions match', () => {
      const result = service.detectConflict(1, 1);
      expect(result).toBe(false);
    });

    it('should detect conflict in both directions', () => {
      expect(service.detectConflict(1, 0)).toBe(true);
      expect(service.detectConflict(0, 1)).toBe(true);
      expect(service.detectConflict(5, 10)).toBe(true);
    });
  });

  describe('classifyConflict()', () => {
    it('should classify write conflict when current > base', () => {
      const conflict = {
        taskId: 'task-1',
        key: 'key1',
        baseVersion: 0,
        currentVersion: 1,
        agentId: 'agent-1',
        timestamp: new Date().toISOString(),
      };

      const type = service.classifyConflict(conflict);
      expect(type).toBe(ConflictType.WRITE_CONFLICT);
    });

    it('should classify version mismatch when current < base', () => {
      const conflict = {
        taskId: 'task-1',
        key: 'key1',
        baseVersion: 5,
        currentVersion: 3,
        agentId: 'agent-1',
        timestamp: new Date().toISOString(),
      };

      const type = service.classifyConflict(conflict);
      expect(type).toBe(ConflictType.VERSION_MISMATCH);
    });

    it('should classify unknown when versions match', () => {
      const conflict = {
        taskId: 'task-1',
        key: 'key1',
        baseVersion: 2,
        currentVersion: 2,
        agentId: 'agent-1',
        timestamp: new Date().toISOString(),
      };

      const type = service.classifyConflict(conflict);
      expect(type).toBe(ConflictType.UNKNOWN);
    });
  });

  describe('logConflict()', () => {
    it('should log a conflict', async () => {
      const conflict = {
        taskId: 'task-1',
        key: 'key1',
        baseVersion: 0,
        currentVersion: 1,
        agentId: 'agent-1',
        timestamp: new Date().toISOString(),
      };

      await expect(service.logConflict(conflict)).resolves.not.toThrow();
    });

    it('should track conflict in metrics', async () => {
      const conflict = {
        taskId: 'task-1',
        key: 'key1',
        baseVersion: 0,
        currentVersion: 1,
        agentId: 'agent-1',
        timestamp: new Date().toISOString(),
      };

      await service.logConflict(conflict);

      const metrics = await service.getMetrics();
      expect(metrics.totalConflicts).toBeGreaterThan(0);
    });

    it('should retrieve logged conflicts', async () => {
      const conflict = {
        taskId: 'task-1',
        key: 'key1',
        baseVersion: 0,
        currentVersion: 1,
        agentId: 'agent-1',
        timestamp: new Date().toISOString(),
      };

      await service.logConflict(conflict);

      const conflicts = await service.getConflictsForKey('task-1', 'key1');
      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts[0].baseVersion).toBe(0);
      expect(conflicts[0].currentVersion).toBe(1);
    });
  });

  describe('trackRetry()', () => {
    it('should track successful retry', async () => {
      await service.trackRetry(1, true);
      const metrics = await service.getMetrics();
      expect(metrics.retryDistribution).toBeDefined();
    });

    it('should track failed retry', async () => {
      await service.trackRetry(3, false);
      const metrics = await service.getMetrics();
      expect(metrics.retryDistribution).toBeDefined();
    });
  });

  describe('getMetrics()', () => {
    it('should return metrics with all counters', async () => {
      const conflict = {
        taskId: 'task-1',
        key: 'key1',
        baseVersion: 0,
        currentVersion: 1,
        agentId: 'agent-1',
        timestamp: new Date().toISOString(),
      };

      await service.logConflict(conflict);

      const metrics = await service.getMetrics();
      expect(metrics).toBeDefined();
      expect(metrics.totalConflicts).toBeDefined();
      expect(metrics.conflictsByType).toBeDefined();
      expect(metrics.retryDistribution).toBeDefined();
      expect(metrics.lastConflictTime).toBeDefined();
    });

    it('should accumulate conflict counts', async () => {
      const conflict1 = {
        taskId: 'task-1',
        key: 'key1',
        baseVersion: 0,
        currentVersion: 1,
        agentId: 'agent-1',
        timestamp: new Date().toISOString(),
      };

      const conflict2 = {
        taskId: 'task-1',
        key: 'key2',
        baseVersion: 0,
        currentVersion: 1,
        agentId: 'agent-2',
        timestamp: new Date().toISOString(),
      };

      await service.logConflict(conflict1);
      await service.logConflict(conflict2);

      const metrics = await service.getMetrics();
      expect(metrics.totalConflicts).toBe(2);
    });
  });

  describe('getConflictsForKey()', () => {
    it('should retrieve conflicts for a specific key', async () => {
      const conflict = {
        taskId: 'task-1',
        key: 'key1',
        baseVersion: 0,
        currentVersion: 1,
        agentId: 'agent-1',
        timestamp: new Date().toISOString(),
      };

      await service.logConflict(conflict);

      const conflicts = await service.getConflictsForKey('task-1', 'key1');
      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts[0].key).toBe('key1');
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await service.logConflict({
          taskId: 'task-1',
          key: 'key1',
          baseVersion: i,
          currentVersion: i + 1,
          agentId: 'agent-1',
          timestamp: new Date().toISOString(),
        });
      }

      const conflicts = await service.getConflictsForKey('task-1', 'key1', 2);
      expect(conflicts.length).toBeLessThanOrEqual(2);
    });
  });

  describe('clearConflictsForKey()', () => {
    it('should clear conflicts for a key', async () => {
      await service.logConflict({
        taskId: 'task-1',
        key: 'key1',
        baseVersion: 0,
        currentVersion: 1,
        agentId: 'agent-1',
        timestamp: new Date().toISOString(),
      });

      await service.clearConflictsForKey('task-1', 'key1');

      const conflicts = await service.getConflictsForKey('task-1', 'key1');
      expect(conflicts.length).toBe(0);
    });
  });

  describe('resetMetrics()', () => {
    it('should reset all metrics', async () => {
      await service.logConflict({
        taskId: 'task-1',
        key: 'key1',
        baseVersion: 0,
        currentVersion: 1,
        agentId: 'agent-1',
        timestamp: new Date().toISOString(),
      });

      await service.resetMetrics();

      const metrics = await service.getMetrics();
      expect(metrics.totalConflicts).toBe(0);
    });
  });
});
