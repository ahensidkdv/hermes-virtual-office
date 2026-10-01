import { Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * Conflict information structure
 */
export interface ConflictInfo {
  taskId: string;
  key: string;
  baseVersion: number;
  currentVersion: number;
  agentId: string;
  timestamp: string;
}

/**
 * Conflict type classification
 */
export enum ConflictType {
  VERSION_MISMATCH = 'version_mismatch',
  WRITE_CONFLICT = 'write_conflict',
  READ_WRITE_CONFLICT = 'read_write_conflict',
  CONCURRENT_WRITE = 'concurrent_write',
  UNKNOWN = 'unknown',
}

/**
 * Conflict Metrics
 */
export interface ConflictMetrics {
  totalConflicts: number;
  conflictsByType: Record<ConflictType, number>;
  retryDistribution: Record<number, number>; // retryCount -> count
  conflictRate: number; // percentage
  lastConflictTime: string | null;
}

/**
 * Conflict Detection Service (Phase 2 Sprint 4 Week 1)
 * Detects, classifies, and tracks conflicts in shared memory operations
 *
 * Responsibilities:
 * - Detect version mismatches (baseVersion != currentVersion)
 * - Classify conflict types
 * - Track conflict metrics (rate, type distribution, retry distribution)
 * - Escalate after max retries
 *
 * Redis keys:
 * - hvo:conflicts:{taskId}:{key} → conflict log (FIFO queue)
 * - hvo:metrics:conflicts → global conflict counter
 * - hvo:metrics:retries → retry count distribution
 */
@Injectable()
export class ConflictDetectionService {
  private readonly logger = new Logger(ConflictDetectionService.name);
  private redis: Redis;

  constructor() {
    this.redis = new (require('ioredis'))(
      {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD,
        retryStrategy: (times: number) => Math.min(times * 50, 2000),
      },
    );

    this.redis.on('error', (err: Error) => {
      this.logger.error(`Redis connection error: ${err.message}`);
    });

    this.redis.on('connect', () => {
      this.logger.log('ConflictDetectionService Redis connected');
    });
  }

  /**
   * Detect if a conflict has occurred
   */
  detectConflict(
    baseVersion: number,
    currentVersion: number,
  ): boolean {
    return baseVersion !== currentVersion;
  }

  /**
   * Classify the type of conflict
   */
  classifyConflict(conflict: ConflictInfo): ConflictType {
    // Version mismatch: current version is ahead
    if (conflict.currentVersion > conflict.baseVersion) {
      return ConflictType.WRITE_CONFLICT;
    }

    // Version mismatch: current version is behind (shouldn't happen)
    if (conflict.currentVersion < conflict.baseVersion) {
      return ConflictType.VERSION_MISMATCH;
    }

    return ConflictType.UNKNOWN;
  }

  /**
   * Log a conflict occurrence
   * Stores in Redis queue for audit trail
   */
  async logConflict(conflict: ConflictInfo): Promise<void> {
    try {
      const conflictKey = `hvo:conflicts:${conflict.taskId}:${conflict.key}`;
      const conflictRecord = {
        ...conflict,
        type: this.classifyConflict(conflict),
        timestamp: new Date().toISOString(),
      };

      // Push to conflict queue (keep last 100)
      await this.redis.lpush(conflictKey, JSON.stringify(conflictRecord));
      await this.redis.ltrim(conflictKey, 0, 99);

      // Increment global conflict counter
      await this.redis.incr('hvo:metrics:conflicts');

      // Update conflict type counter
      const typeKey = `hvo:metrics:conflicts:${conflictRecord.type}`;
      await this.redis.incr(typeKey);

      // Update last conflict time
      await this.redis.set(
        'hvo:metrics:conflicts:last',
        new Date().toISOString(),
      );

      this.logger.debug(
        `Logged conflict: ${conflict.taskId}:${conflict.key} (v${conflict.baseVersion} -> v${conflict.currentVersion})`,
      );
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to log conflict: ${err.message}`, error);
      // Don't throw - continue even if logging fails
    }
  }

  /**
   * Track a retry attempt
   */
  async trackRetry(retryCount: number, success: boolean): Promise<void> {
    try {
      const key = success
        ? `hvo:metrics:retries:success:${retryCount}`
        : `hvo:metrics:retries:failed:${retryCount}`;
      await this.redis.incr(key);
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to track retry: ${err.message}`);
    }
  }

  /**
   * Get conflict metrics
   */
  async getMetrics(): Promise<ConflictMetrics> {
    try {
      const totalConflicts = parseInt(
        (await this.redis.get('hvo:metrics:conflicts')) || '0',
        10,
      );

      const conflictsByType: Record<ConflictType, number> = {
        [ConflictType.VERSION_MISMATCH]: 0,
        [ConflictType.WRITE_CONFLICT]: 0,
        [ConflictType.READ_WRITE_CONFLICT]: 0,
        [ConflictType.CONCURRENT_WRITE]: 0,
        [ConflictType.UNKNOWN]: 0,
      };

      // Get counters for each type
      for (const type of Object.values(ConflictType)) {
        const count = parseInt(
          (await this.redis.get(`hvo:metrics:conflicts:${type}`)) || '0',
          10,
        );
        conflictsByType[type] = count;
      }

      // Get retry distribution
      const retryKeys = await this.redis.keys('hvo:metrics:retries:*');
      const retryDistribution: Record<number, number> = {};

      for (const key of retryKeys) {
        const countStr = await this.redis.get(key);
        const count = parseInt(countStr || '0', 10);
        const match = key.match(/hvo:metrics:retries:(?:success|failed):(\\d+)/);
        if (match) {
          const retryNum = parseInt(match[1], 10);
          retryDistribution[retryNum] =
            (retryDistribution[retryNum] || 0) + count;
        }
      }

      const lastConflictTime = await this.redis.get(
        'hvo:metrics:conflicts:last',
      );

      return {
        totalConflicts,
        conflictsByType,
        retryDistribution,
        conflictRate: 0, // Calculated by caller based on total ops
        lastConflictTime: lastConflictTime || null,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to get metrics: ${err.message}`, error);
      throw error;
    }
  }

  /**
   * Reset conflict metrics (for testing)
   */
  async resetMetrics(): Promise<void> {
    try {
      const keys = await this.redis.keys('hvo:metrics:conflicts*');
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }

      const retryKeys = await this.redis.keys('hvo:metrics:retries*');
      if (retryKeys.length > 0) {
        await this.redis.del(...retryKeys);
      }

      this.logger.log('Conflict metrics reset');
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to reset metrics: ${err.message}`, error);
      throw error;
    }
  }

  /**
   * Get conflicts for a specific task/key
   */
  async getConflictsForKey(
    taskId: string,
    key: string,
    limit: number = 10,
  ): Promise<ConflictInfo[]> {
    try {
      const conflictKey = `hvo:conflicts:${taskId}:${key}`;
      const records = await this.redis.lrange(conflictKey, 0, limit - 1);

      return records.map((record) => JSON.parse(record) as ConflictInfo);
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to get conflicts: ${err.message}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Clear conflicts for a specific task/key
   */
  async clearConflictsForKey(taskId: string, key: string): Promise<void> {
    try {
      const conflictKey = `hvo:conflicts:${taskId}:${key}`;
      await this.redis.del(conflictKey);
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to clear conflicts: ${err.message}`,
        error,
      );
      throw error;
    }
  }
}
