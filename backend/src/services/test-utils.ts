import { Test, TestingModule } from '@nestjs/testing';
import { SharedMemoryService } from './shared-memory.service';
import { ConflictDetectionService } from './conflict-detection.service';
import { AuditTrailService } from './audit-trail.service';

/**
 * Mock Redis for testing
 * Simulates Redis in-memory store
 */
export class MockRedis {
  private store: Map<string, string> = new Map();
  private lists: Map<string, string[]> = new Map();

  async get(key: string): Promise<string | null> {
    const value = this.store.get(key);
    return value || null;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.store.has(key)) {
        this.store.delete(key);
        count++;
      }
      if (this.lists.has(key)) {
        this.lists.delete(key);
        count++;
      }
    }
    return count;
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

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
    );
    const allKeys = [
      ...this.store.keys(),
      ...this.lists.keys(),
    ];
    return allKeys.filter((key) => regex.test(key));
  }

  async expire(key: string, seconds: number): Promise<void> {
    // No-op for mock
  }

  on(event: string, callback: (err?: Error) => void): void {
    // No-op for mock
  }

  clear(): void {
    this.store.clear();
    this.lists.clear();
  }
}

/**
 * Test utilities and setup
 */
export async function setupTestingModule(): Promise<{
  module: TestingModule;
  memoryService: SharedMemoryService;
  conflictService: ConflictDetectionService;
  auditService: AuditTrailService;
  redis: MockRedis;
}> {
  const redis = new MockRedis();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      {
        provide: 'REDIS',
        useValue: redis,
      },
      {
        provide: SharedMemoryService,
        useFactory: () => {
          const service = new SharedMemoryService();
          (service as any).redis = redis;
          return service;
        },
      },
      {
        provide: ConflictDetectionService,
        useFactory: () => {
          const service = new ConflictDetectionService();
          (service as any).redis = redis;
          return service;
        },
      },
      {
        provide: AuditTrailService,
        useFactory: () => {
          const service = new AuditTrailService();
          (service as any).redis = redis;
          return service;
        },
      },
    ],
  }).compile();

  const memoryService =
    module.get<SharedMemoryService>(SharedMemoryService);
  const conflictService = module.get<ConflictDetectionService>(
    ConflictDetectionService,
  );
  const auditService = module.get<AuditTrailService>(AuditTrailService);

  return {
    module,
    memoryService,
    conflictService,
    auditService,
    redis,
  };
}
