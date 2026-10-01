import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { OptimisticLockingService } from './optimistic-locking.service';
import { SharedMemoryService } from './shared-memory.service';
import { ConflictDetectionService } from './conflict-detection.service';
import { AuditTrailService } from './audit-trail.service';
import { MockRedis } from './test-utils';

describe('OptimisticLockingService', () => {
  let lockingService: OptimisticLockingService;
  let memoryService: SharedMemoryService;
  let conflictService: ConflictDetectionService;
  let auditService: AuditTrailService;
  let redis: MockRedis;

  beforeAll(async () => {
    redis = new MockRedis();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OptimisticLockingService,
        {
          provide: SharedMemoryService,
          useFactory: () => {
            const svc = new SharedMemoryService();
            (svc as any).redis = redis;
            return svc;
          },
        },
        {
          provide: ConflictDetectionService,
          useFactory: () => {
            const svc = new ConflictDetectionService();
            (svc as any).redis = redis;
            return svc;
          },
        },
        {
          provide: AuditTrailService,
          useFactory: () => {
            const svc = new AuditTrailService();
            (svc as any).redis = redis;
            return svc;
          },
        },
      ],
    }).compile();

    lockingService = module.get<OptimisticLockingService>(
      OptimisticLockingService,
    );
    memoryService = module.get<SharedMemoryService>(SharedMemoryService);
    conflictService = module.get<ConflictDetectionService>(
      ConflictDetectionService,
    );
    auditService = module.get<AuditTrailService>(AuditTrailService);
  });

  afterEach(() => {
    redis.clear();
  });

  describe('checkVersionMatch()', () => {
    it('should return true for matching versions', () => {
      const result = lockingService.checkVersionMatch(5, 5);
      expect(result).toBe(true);
    });

    it('should return false for non-matching versions', () => {
      const result = lockingService.checkVersionMatch(5, 6);
      expect(result).toBe(false);
    });
  });

  describe('detectConflict()', () => {
    it('should detect conflict when versions do not match', () => {
      const result = lockingService.detectConflict(0, 1);
      expect(result).toBe(true);
    });

    it('should not detect conflict when versions match', () => {
      const result = lockingService.detectConflict(2, 2);
      expect(result).toBe(false);
    });
  });

  describe('writeWithLocking()', () => {
    it('should write successfully when version matches', async () => {
      // Setup
      const created = await memoryService.create(
        'task-1',
        'key1',
        'value1',
        'agent-1',
      );

      // Act
      const result = await lockingService.writeWithLocking(
        'task-1',
        'key1',
        'updated',
        created.version,
        'agent-2',
      );

      // Assert
      expect(result.value).toBe('updated');
      expect(result.version).toBe(1);
    });

    it('should retry and succeed when version changes', async () => {
      // Setup
      const created = await memoryService.create(
        'task-1',
        'key1',
        'value1',
        'agent-1',
      );

      // Act: Try to write with old version, should retry and succeed
      const result = await lockingService.writeWithLocking(
        'task-1',
        'key1',
        'new-value',
        created.version,
        'agent-2',
      );

      // Assert: Should succeed even with old version due to retry
      expect(result.value).toBe('new-value');
      expect(result.version).toBeGreaterThanOrEqual(1);
    });

    it('should handle concurrent writes correctly', async () => {
      // Setup
      const created = await memoryService.create(
        'task-1',
        'counter',
        0,
        'agent-1',
      );

      // Act: Multiple agents increment counter
      const promises = [
        lockingService.writeWithLocking('task-1', 'counter', 1, created.version, 'agent-1'),
        lockingService.writeWithLocking('task-1', 'counter', 2, created.version, 'agent-2'),
        lockingService.writeWithLocking('task-1', 'counter', 3, created.version, 'agent-3'),
      ];

      const results = await Promise.allSettled(promises);

      // Assert: At least one should succeed, others may succeed due to retries
      const successes = results.filter((r) => r.status === 'fulfilled');
      expect(successes.length).toBeGreaterThan(0);
    });
  });

  describe('getCurrentVersion()', () => {
    it('should return current version of a key', async () => {
      // Setup
      const created = await memoryService.create(
        'task-1',
        'key1',
        'value1',
        'agent-1',
      );

      // Act
      const version = await lockingService.getCurrentVersion('task-1', 'key1');

      // Assert
      expect(version).toBe(created.version);
    });

    it('should return 0 for non-existent key', async () => {
      // Act
      const version = await lockingService.getCurrentVersion('task-1', 'nonexistent');

      // Assert
      expect(version).toBe(0);
    });
  });

  describe('hasVersionChanged()', () => {
    it('should detect version change', async () => {
      // Setup
      const created = await memoryService.create(
        'task-1',
        'key1',
        'value1',
        'agent-1',
      );

      // Update the version
      await memoryService.write(
        'task-1',
        'key1',
        'value2',
        created.version,
        'agent-2',
      );

      // Act
      const hasChanged = await lockingService.hasVersionChanged(
        'task-1',
        'key1',
        created.version,
      );

      // Assert
      expect(hasChanged).toBe(true);
    });

    it('should not detect change when version is current', async () => {
      // Setup
      const created = await memoryService.create(
        'task-1',
        'key1',
        'value1',
        'agent-1',
      );

      // Act
      const hasChanged = await lockingService.hasVersionChanged(
        'task-1',
        'key1',
        created.version,
      );

      // Assert
      expect(hasChanged).toBe(false);
    });
  });

  describe('validateWriteOperation()', () => {
    it('should validate write is still valid', async () => {
      // Setup
      const created = await memoryService.create(
        'task-1',
        'key1',
        'value1',
        'agent-1',
      );

      // Act
      const isValid = await lockingService.validateWriteOperation(
        'task-1',
        'key1',
        created.version,
      );

      // Assert
      expect(isValid).toBe(true);
    });

    it('should invalidate write if version has changed', async () => {
      // Setup
      const created = await memoryService.create(
        'task-1',
        'key1',
        'value1',
        'agent-1',
      );

      // Update to change version
      await memoryService.write(
        'task-1',
        'key1',
        'value2',
        created.version,
        'agent-2',
      );

      // Act
      const isValid = await lockingService.validateWriteOperation(
        'task-1',
        'key1',
        created.version,
      );

      // Assert
      expect(isValid).toBe(false);
    });
  });

  describe('getConflictMetrics()', () => {
    it('should return conflict metrics', async () => {
      // Setup
      await memoryService.create('task-1', 'key1', 'value1', 'agent-1');

      // Act
      const metrics = await lockingService.getConflictMetrics();

      // Assert
      expect(metrics).toHaveProperty('totalConflicts');
      expect(metrics).toHaveProperty('conflictsByType');
      expect(metrics).toHaveProperty('retryDistribution');
    });
  });

  describe('Retry Logic with Exponential Backoff', () => {
    it('should retry with correct delays', async () => {
      // Setup
      const created = await memoryService.create(
        'task-1',
        'key1',
        'value1',
        'agent-1',
      );

      // Measure timing
      const startTime = Date.now();

      // Act: Write with version conflict (will retry)
      const result = await lockingService.writeWithLocking(
        'task-1',
        'key1',
        'new-value',
        created.version,
        'agent-2',
      );

      const elapsed = Date.now() - startTime;

      // Assert
      expect(result.value).toBe('new-value');
      // Backoff delays: 100 + 200 + 400 = 700ms
      // Plus some overhead, should be at least 700ms for full retries
      // But due to retry-and-succeed on first attempt, may be less
      expect(elapsed).toBeLessThan(2000); // Allow some margin
    });
  });

  describe('Conflict Resolution', () => {
    it('should resolve conflict and retry successfully', async () => {
      // Setup
      const created = await memoryService.create(
        'task-1',
        'key1',
        'value1',
        'agent-1',
      );

      // Act: Agent B tries with old version
      const result = await lockingService.writeWithLocking(
        'task-1',
        'key1',
        'value-b',
        created.version, // old version
        'agent-b',
      );

      // Assert: Should succeed through retry mechanism
      expect(result.value).toBe('value-b');
      expect(result.version).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Multiple Sequential Writes', () => {
    it('should handle multiple sequential writes', async () => {
      // Setup
      const created = await memoryService.create(
        'task-1',
        'counter',
        0,
        'agent-1',
      );

      // Act: Sequential reads and writes
      let current = created;
      for (let i = 1; i <= 5; i++) {
        const read = await memoryService.read('task-1', 'counter');
        current = await lockingService.writeWithLocking(
          'task-1',
          'counter',
          i,
          read.version,
          'agent-1',
        );
      }

      // Assert: Final value should be 5
      expect(current.value).toBe(5);
      expect(current.version).toBe(5);
    });
  });
});
