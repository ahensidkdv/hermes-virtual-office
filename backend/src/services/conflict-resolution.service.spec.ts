import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictResolutionService,
  ResolutionStrategy,
  ConflictMetadata,
} from './conflict-resolution.service';

/**
 * Mock Redis for testing
 */
class MockRedis {
  private store: Map<string, string> = new Map();
  private lists: Map<string, string[]> = new Map();
  private published: Array<[string, string]> = [];
  private listeners: Map<string, Function[]> = new Map();

  on(event: string, callback: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  off(event: string, callback: Function): void {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event)!;
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) || null;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async incr(key: string): Promise<number> {
    const current = parseInt(this.store.get(key) || '0', 10);
    const newValue = current + 1;
    this.store.set(key, newValue.toString());
    return newValue;
  }

  async lpush(key: string, ...values: string[]): Promise<number> {
    const list = this.lists.get(key) || [];
    list.unshift(...values);
    this.lists.set(key, list);
    return list.length;
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key) || [];
    if (stop === -1) {
      return list.slice(start);
    }
    return list.slice(start, stop + 1);
  }

  async ltrim(key: string, start: number, stop: number): Promise<void> {
    const list = this.lists.get(key) || [];
    const trimmed = list.slice(start, stop + 1);
    this.lists.set(key, trimmed);
  }

  async expire(key: string, seconds: number): Promise<void> {
    // No-op for mock
  }

  async publish(channel: string, message: string): Promise<number> {
    this.published.push([channel, message]);
    return 1;
  }

  getPublished(): Array<[string, string]> {
    return this.published;
  }

  async quit(): Promise<void> {
    // No-op for mock
  }
}

describe('ConflictResolutionService (Phase 2 Week 2-3)', () => {
  let service: ConflictResolutionService;
  let mockRedis: MockRedis;

  beforeEach(async () => {
    mockRedis = new MockRedis();
    service = new ConflictResolutionService(mockRedis as any);
  });

  afterEach(async () => {
    await service.close();
  });

  describe('Strategy: Last-Write-Wins (LWW)', () => {
    beforeEach(async () => {
      await service.setTaskStrategy(
        'task-1',
        ResolutionStrategy.LAST_WRITE_WINS,
      );
    });

    it('should resolve conflict to most recent write', async () => {
      const now = Date.now();
      const metadata: ConflictMetadata = {
        baseVersion: 1,
        currentVersion: 2,
        proposedValue: { data: 'proposed' },
        currentValue: { data: 'current' },
        proposedAgentId: 'agent-1',
        currentAgentId: 'agent-2',
        proposedTimestamp: new Date(now - 1000).toISOString(), // older
        currentTimestamp: new Date(now).toISOString(), // newer
      };

      const result = await service.resolveConflict('task-1', 'key-1', metadata);

      expect(result).toMatchObject({
        strategy: ResolutionStrategy.LAST_WRITE_WINS,
        resolved: true,
        winnerAgentId: 'agent-2', // Current (newer)
        loserAgentId: 'agent-1',
        selectedValue: { data: 'current' },
      });
      expect(result.resolutionTime).toBeGreaterThanOrEqual(0);
    });

    it('should select proposed value when it is more recent', async () => {
      const now = Date.now();
      const metadata: ConflictMetadata = {
        baseVersion: 1,
        currentVersion: 2,
        proposedValue: { data: 'latest' },
        currentValue: { data: 'old' },
        proposedAgentId: 'agent-1',
        currentAgentId: 'agent-2',
        proposedTimestamp: new Date(now).toISOString(), // newer
        currentTimestamp: new Date(now - 1000).toISOString(), // older
      };

      const result = await service.resolveConflict('task-1', 'key-1', metadata);

      expect(result.winnerAgentId).toBe('agent-1');
      expect(result.loserAgentId).toBe('agent-2');
      expect(result.selectedValue).toEqual({ data: 'latest' });
    });

    it('should publish conflict.resolved event', async () => {
      const metadata: ConflictMetadata = {
        baseVersion: 1,
        currentVersion: 2,
        proposedValue: 'new',
        currentValue: 'old',
        proposedAgentId: 'agent-1',
        currentAgentId: 'agent-2',
        proposedTimestamp: new Date().toISOString(),
        currentTimestamp: new Date(Date.now() - 1000).toISOString(),
      };

      await service.resolveConflict('task-1', 'key-1', metadata);

      const published = mockRedis.getPublished();
      expect(published.length).toBeGreaterThan(0);
      const [channel, message] = published[published.length - 1];
      expect(channel).toBe('hvo:events:conflicts');

      const event = JSON.parse(message);
      expect(event.type).toBe('conflict.resolved');
      expect(event.taskId).toBe('task-1');
      expect(event.key).toBe('key-1');
    });

    it('should track resolution time', async () => {
      const metadata: ConflictMetadata = {
        baseVersion: 1,
        currentVersion: 2,
        proposedValue: 'new',
        currentValue: 'old',
        proposedAgentId: 'agent-1',
        currentAgentId: 'agent-2',
        proposedTimestamp: new Date().toISOString(),
        currentTimestamp: new Date(Date.now() - 1000).toISOString(),
      };

      const result = await service.resolveConflict('task-1', 'key-1', metadata);

      expect(result.resolutionTime).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('Strategy: Version-Priority', () => {
    beforeEach(async () => {
      await service.setTaskStrategy(
        'task-2',
        ResolutionStrategy.VERSION_PRIORITY,
      );
    });

    it('should resolve to higher version value', async () => {
      const metadata: ConflictMetadata = {
        baseVersion: 1,
        currentVersion: 3, // Higher version
        proposedValue: { data: 'v2' },
        currentValue: { data: 'v3' },
        proposedAgentId: 'agent-1',
        currentAgentId: 'agent-2',
        proposedTimestamp: new Date().toISOString(),
        currentTimestamp: new Date().toISOString(),
      };

      const result = await service.resolveConflict('task-2', 'key-1', metadata);

      expect(result).toMatchObject({
        strategy: ResolutionStrategy.VERSION_PRIORITY,
        resolved: true,
        selectedVersion: 4, // max(3, 1) + 1
        winnerAgentId: 'agent-2', // Higher version
      });
    });

    it('should work when base version is lower', async () => {
      const metadata: ConflictMetadata = {
        baseVersion: 1,
        currentVersion: 2,
        proposedValue: 'v1',
        currentValue: 'v2',
        proposedAgentId: 'agent-1',
        currentAgentId: 'agent-2',
        proposedTimestamp: new Date().toISOString(),
        currentTimestamp: new Date().toISOString(),
      };

      const result = await service.resolveConflict('task-2', 'key-1', metadata);

      expect(result.selectedVersion).toBe(3); // max(2, 1) + 1
      expect(result.winnerAgentId).toBe('agent-2');
    });
  });

  describe('Strategy: Manual Resolution', () => {
    beforeEach(async () => {
      await service.setTaskStrategy(
        'task-3',
        ResolutionStrategy.MANUAL_RESOLUTION,
      );
    });

    it('should mark conflict as manual escalation', async () => {
      const metadata: ConflictMetadata = {
        baseVersion: 1,
        currentVersion: 2,
        proposedValue: 'proposed',
        currentValue: 'current',
        proposedAgentId: 'agent-1',
        currentAgentId: 'agent-2',
        proposedTimestamp: new Date().toISOString(),
        currentTimestamp: new Date().toISOString(),
      };

      const result = await service.resolveConflict('task-3', 'key-1', metadata);

      expect(result.strategy).toBe(ResolutionStrategy.MANUAL_RESOLUTION);
      expect(result.resolved).toBe(true);
    });

    it('should fallback to LWW until manual decision', async () => {
      const now = Date.now();
      const metadata: ConflictMetadata = {
        baseVersion: 1,
        currentVersion: 2,
        proposedValue: 'older',
        currentValue: 'newer',
        proposedAgentId: 'agent-1',
        currentAgentId: 'agent-2',
        proposedTimestamp: new Date(now - 1000).toISOString(),
        currentTimestamp: new Date(now).toISOString(),
      };

      const result = await service.resolveConflict('task-3', 'key-1', metadata);

      // Should use LWW logic until manual resolution
      expect(result.winnerAgentId).toBe('agent-2');
    });
  });

  describe('Task Strategy Configuration', () => {
    it('should set and retrieve task strategy', async () => {
      await service.setTaskStrategy('task-5', ResolutionStrategy.VERSION_PRIORITY);
      const strategy = await service.getTaskStrategy('task-5');

      expect(strategy).toBe(ResolutionStrategy.VERSION_PRIORITY);
    });

    it('should default to LAST_WRITE_WINS if not configured', async () => {
      const strategy = await service.getTaskStrategy('unknown-task');
      expect(strategy).toBe(ResolutionStrategy.LAST_WRITE_WINS);
    });

    it('should allow per-task strategy customization', async () => {
      // Task 1: LWW
      await service.setTaskStrategy('task-lww', ResolutionStrategy.LAST_WRITE_WINS);

      // Task 2: Version Priority
      await service.setTaskStrategy('task-vp', ResolutionStrategy.VERSION_PRIORITY);

      const strategy1 = await service.getTaskStrategy('task-lww');
      const strategy2 = await service.getTaskStrategy('task-vp');

      expect(strategy1).toBe(ResolutionStrategy.LAST_WRITE_WINS);
      expect(strategy2).toBe(ResolutionStrategy.VERSION_PRIORITY);
    });
  });

  describe('Resolution History and Metrics', () => {
    it('should record resolution in history', async () => {
      await service.setTaskStrategy('task-6', ResolutionStrategy.LAST_WRITE_WINS);

      const metadata: ConflictMetadata = {
        baseVersion: 1,
        currentVersion: 2,
        proposedValue: 'new',
        currentValue: 'old',
        proposedAgentId: 'agent-1',
        currentAgentId: 'agent-2',
        proposedTimestamp: new Date().toISOString(),
        currentTimestamp: new Date().toISOString(),
      };

      await service.resolveConflict('task-6', 'key-1', metadata);

      const history = await service.getResolutionHistory('task-6', 10);
      expect(history.length).toBeGreaterThan(0);
      expect(history[0].strategy).toBe(ResolutionStrategy.LAST_WRITE_WINS);
    });

    it('should retrieve multiple resolutions in history', async () => {
      await service.setTaskStrategy('task-7', ResolutionStrategy.LAST_WRITE_WINS);

      const baseMetadata: ConflictMetadata = {
        baseVersion: 1,
        currentVersion: 2,
        proposedValue: 'val1',
        currentValue: 'val2',
        proposedAgentId: 'agent-1',
        currentAgentId: 'agent-2',
        proposedTimestamp: new Date().toISOString(),
        currentTimestamp: new Date().toISOString(),
      };

      // Resolve multiple conflicts
      for (let i = 0; i < 3; i++) {
        const metadata = { ...baseMetadata, proposedValue: `val${i}` };
        await service.resolveConflict('task-7', `key-${i}`, metadata);
      }

      const history = await service.getResolutionHistory('task-7', 10);
      expect(history.length).toBe(3);
    });

    it('should track resolution metrics', async () => {
      await service.setTaskStrategy('task-8', ResolutionStrategy.LAST_WRITE_WINS);

      const metadata: ConflictMetadata = {
        baseVersion: 1,
        currentVersion: 2,
        proposedValue: 'new',
        currentValue: 'old',
        proposedAgentId: 'agent-1',
        currentAgentId: 'agent-2',
        proposedTimestamp: new Date().toISOString(),
        currentTimestamp: new Date().toISOString(),
      };

      await service.resolveConflict('task-8', 'key-1', metadata);

      const metrics = await service.getMetrics(ResolutionStrategy.LAST_WRITE_WINS);

      expect(metrics.totalResolutions).toBeGreaterThan(0);
      expect(metrics.averageResolutionTime).toBeGreaterThanOrEqual(0);
      expect(metrics.p95ResolutionTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Conflict Metrics Tracking', () => {
    it('should record conflict count by strategy', async () => {
      await service.setTaskStrategy('task-9', ResolutionStrategy.VERSION_PRIORITY);

      const metadata: ConflictMetadata = {
        baseVersion: 1,
        currentVersion: 2,
        proposedValue: 'new',
        currentValue: 'old',
        proposedAgentId: 'agent-1',
        currentAgentId: 'agent-2',
        proposedTimestamp: new Date().toISOString(),
        currentTimestamp: new Date().toISOString(),
      };

      // Resolve conflict
      await service.resolveConflict('task-9', 'key-1', metadata);

      // Get metrics
      const metrics = await service.getMetrics(ResolutionStrategy.VERSION_PRIORITY);
      expect(metrics.totalResolutions).toBeGreaterThan(0);
    });

    it('should calculate percentile latencies', async () => {
      await service.setTaskStrategy('task-10', ResolutionStrategy.LAST_WRITE_WINS);

      const metadata: ConflictMetadata = {
        baseVersion: 1,
        currentVersion: 2,
        proposedValue: 'val',
        currentValue: 'val2',
        proposedAgentId: 'agent-1',
        currentAgentId: 'agent-2',
        proposedTimestamp: new Date().toISOString(),
        currentTimestamp: new Date().toISOString(),
      };

      // Simulate multiple resolutions
      for (let i = 0; i < 5; i++) {
        await service.resolveConflict('task-10', `key-${i}`, metadata);
      }

      const metrics = await service.getMetrics(ResolutionStrategy.LAST_WRITE_WINS);

      expect(metrics.p95ResolutionTime).toBeDefined();
      expect(metrics.p99ResolutionTime).toBeDefined();
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle missing metadata gracefully', async () => {
      await service.setTaskStrategy('task-11', ResolutionStrategy.LAST_WRITE_WINS);

      const metadata: ConflictMetadata = {
        baseVersion: 1,
        currentVersion: 1, // Same versions
        proposedValue: null,
        currentValue: null,
        proposedAgentId: 'agent-1',
        currentAgentId: 'agent-2',
        proposedTimestamp: new Date().toISOString(),
        currentTimestamp: new Date().toISOString(),
      };

      const result = await service.resolveConflict('task-11', 'key-1', metadata);
      expect(result.resolved).toBe(true);
    });

    it('should handle concurrent resolution attempts', async () => {
      await service.setTaskStrategy('task-12', ResolutionStrategy.LAST_WRITE_WINS);

      const metadata: ConflictMetadata = {
        baseVersion: 1,
        currentVersion: 2,
        proposedValue: 'val',
        currentValue: 'val2',
        proposedAgentId: 'agent-1',
        currentAgentId: 'agent-2',
        proposedTimestamp: new Date().toISOString(),
        currentTimestamp: new Date().toISOString(),
      };

      // Simulate concurrent resolutions
      const results = await Promise.all([
        service.resolveConflict('task-12', 'key-1', metadata),
        service.resolveConflict('task-12', 'key-2', metadata),
        service.resolveConflict('task-12', 'key-3', metadata),
      ]);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.resolved)).toBe(true);
    });

    it('should handle large value objects', async () => {
      await service.setTaskStrategy('task-13', ResolutionStrategy.LAST_WRITE_WINS);

      const largeValue = {
        data: 'x'.repeat(10000),
        nested: {
          deep: {
            value: 'y'.repeat(5000),
          },
        },
      };

      const metadata: ConflictMetadata = {
        baseVersion: 1,
        currentVersion: 2,
        proposedValue: largeValue,
        currentValue: { data: 'small' },
        proposedAgentId: 'agent-1',
        currentAgentId: 'agent-2',
        proposedTimestamp: new Date().toISOString(),
        currentTimestamp: new Date().toISOString(),
      };

      const result = await service.resolveConflict('task-13', 'key-1', metadata);
      expect(result.resolved).toBe(true);
    });
  });

  describe('Compatibility with Phase 2 Existing Services', () => {
    it('should work with SharedMemory conflict scenarios', async () => {
      // Simulate scenario: SharedMemory detects conflict, ConflictResolution resolves it
      await service.setTaskStrategy('task-sm-1', ResolutionStrategy.LAST_WRITE_WINS);

      const metadata: ConflictMetadata = {
        baseVersion: 5,
        currentVersion: 6,
        proposedValue: { summary: 'Agent A summary' },
        currentValue: { summary: 'Agent B summary' },
        proposedAgentId: 'agent-a-001',
        currentAgentId: 'agent-b-002',
        proposedTimestamp: new Date(Date.now() - 500).toISOString(),
        currentTimestamp: new Date().toISOString(),
      };

      const result = await service.resolveConflict('task-sm-1', 'research_summary', metadata);

      expect(result.resolved).toBe(true);
      expect(result.selectedValue).toEqual({ summary: 'Agent B summary' });
    });

    it('should integrate with AuditTrail service pattern', async () => {
      // Simulate audit logging pattern used by AuditTrailService
      await service.setTaskStrategy('task-audit-1', ResolutionStrategy.LAST_WRITE_WINS);

      const metadata: ConflictMetadata = {
        baseVersion: 1,
        currentVersion: 2,
        proposedValue: { progress: 50 },
        currentValue: { progress: 75 },
        proposedAgentId: 'agent-1',
        currentAgentId: 'agent-2',
        proposedTimestamp: new Date(Date.now() - 1000).toISOString(),
        currentTimestamp: new Date().toISOString(),
      };

      const result = await service.resolveConflict('task-audit-1', 'progress', metadata);

      expect(result.resolved).toBe(true);
      // Can be integrated into audit trail after resolution
      expect(result.timestamp).toBeDefined();
    });
  });
});
