import { Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * Audit trail entry
 */
export interface AuditEntry {
  id: string;
  taskId: string;
  key: string;
  agentId: string;
  operation: 'read' | 'write' | 'delete' | 'conflict';
  timestamp: string;
  version?: number;
  baseVersion?: number;
  currentVersion?: number;
  value?: any;
  metadata?: Record<string, any>;
}

/**
 * Query filters for audit trail
 */
export interface AuditQueryFilters {
  agentId?: string;
  operation?: 'read' | 'write' | 'delete' | 'conflict';
  startTime?: string;
  endTime?: string;
  limit?: number;
}

/**
 * Audit Trail Service (Phase 2 Sprint 4 Week 1)
 * Logs all read/write/delete/conflict operations on shared memory
 *
 * Architecture:
 * - Redis queue: hvo:audit:{taskId} (FIFO queue of all operations)
 * - Indexed by agent: hvo:audit:by-agent:{agentId}
 * - Indexed by operation: hvo:audit:by-op:{operation}
 * - Global audit log: hvo:audit:global
 * - PostgreSQL (optional): sync periodic summaries to DB for long-term retention
 *
 * Usage:
 * - Log every read/write/delete/conflict
 * - Query by agent, operation, time range
 * - Calculate conflict rate, retry rate
 * - Alert on suspicious patterns (e.g., high conflict rate)
 */
@Injectable()
export class AuditTrailService {
  private readonly logger = new Logger(AuditTrailService.name);
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
      this.logger.log('AuditTrailService Redis connected');
    });
  }

  /**
   * Log read access
   */
  async logReadAccess(
    taskId: string,
    key: string,
    agentId: string,
  ): Promise<void> {
    try {
      const entry: AuditEntry = {
        id: `${taskId}:${key}:read:${Date.now()}`,
        taskId,
        key,
        agentId,
        operation: 'read',
        timestamp: new Date().toISOString(),
      };

      await this.logAuditEntry(entry);
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to log read access: ${err.message}`,
        error,
      );
    }
  }

  /**
   * Log write access
   */
  async logWriteAccess(
    taskId: string,
    key: string,
    agentId: string,
    version: number,
    value?: any,
  ): Promise<void> {
    try {
      const entry: AuditEntry = {
        id: `${taskId}:${key}:write:${Date.now()}`,
        taskId,
        key,
        agentId,
        operation: 'write',
        timestamp: new Date().toISOString(),
        version,
        value: value ? JSON.stringify(value).substring(0, 100) : undefined, // Truncate for storage
      };

      await this.logAuditEntry(entry);
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to log write access: ${err.message}`,
        error,
      );
    }
  }

  /**
   * Log delete operation
   */
  async logDeleteAccess(
    taskId: string,
    key: string,
    agentId: string,
  ): Promise<void> {
    try {
      const entry: AuditEntry = {
        id: `${taskId}:${key}:delete:${Date.now()}`,
        taskId,
        key,
        agentId,
        operation: 'delete',
        timestamp: new Date().toISOString(),
      };

      await this.logAuditEntry(entry);
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to log delete access: ${err.message}`,
        error,
      );
    }
  }

  /**
   * Log conflict
   */
  async logConflict(
    taskId: string,
    key: string,
    agentId: string,
    baseVersion: number,
    currentVersion: number,
    metadata?: Record<string, any>,
  ): Promise<void> {
    try {
      const entry: AuditEntry = {
        id: `${taskId}:${key}:conflict:${Date.now()}`,
        taskId,
        key,
        agentId,
        operation: 'conflict',
        timestamp: new Date().toISOString(),
        baseVersion,
        currentVersion,
        metadata,
      };

      await this.logAuditEntry(entry);

      // Increment conflict counter for this agent
      const agentConflictKey = `hvo:audit:agent-conflicts:${agentId}`;
      await this.redis.incr(agentConflictKey);
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to log conflict: ${err.message}`,
        error,
      );
    }
  }

  /**
   * Internal: Log an audit entry to all indexes
   */
  private async logAuditEntry(entry: AuditEntry): Promise<void> {
    const entryJson = JSON.stringify(entry);

    // Main audit queue for task
    const taskAuditKey = `hvo:audit:${entry.taskId}`;
    await this.redis.lpush(taskAuditKey, entryJson);
    // Keep last 1000 entries per task
    await this.redis.ltrim(taskAuditKey, 0, 999);

    // Index by agent
    const agentAuditKey = `hvo:audit:by-agent:${entry.agentId}`;
    await this.redis.lpush(agentAuditKey, entryJson);
    await this.redis.ltrim(agentAuditKey, 0, 999);

    // Index by operation
    const opAuditKey = `hvo:audit:by-op:${entry.operation}`;
    await this.redis.lpush(opAuditKey, entryJson);
    await this.redis.ltrim(opAuditKey, 0, 999);

    // Global audit log
    await this.redis.lpush('hvo:audit:global', entryJson);
    await this.redis.ltrim('hvo:audit:global', 0, 9999);

    // Set expiry (7 days for audit trail)
    await this.redis.expire(taskAuditKey, 604800);
    await this.redis.expire(agentAuditKey, 604800);
    await this.redis.expire(opAuditKey, 604800);
  }

  /**
   * Query audit trail with filters
   */
  async getAuditTrail(
    taskId: string,
    filters?: AuditQueryFilters,
  ): Promise<AuditEntry[]> {
    try {
      const limit = filters?.limit || 100;
      let auditKey = `hvo:audit:${taskId}`;

      // Apply filters
      if (filters?.agentId) {
        auditKey = `hvo:audit:by-agent:${filters.agentId}`;
      } else if (filters?.operation) {
        auditKey = `hvo:audit:by-op:${filters.operation}`;
      }

      // Get entries
      const entries = await this.redis.lrange(auditKey, 0, limit - 1);
      const results: AuditEntry[] = entries
        .map((entry) => JSON.parse(entry) as AuditEntry)
        .reverse(); // Most recent last

      // Apply time filters if specified
      if (filters?.startTime || filters?.endTime) {
        return results.filter((entry) => {
          const entryTime = new Date(entry.timestamp).getTime();
          const startTime = filters.startTime
            ? new Date(filters.startTime).getTime()
            : 0;
          const endTime = filters.endTime
            ? new Date(filters.endTime).getTime()
            : Date.now();

          return entryTime >= startTime && entryTime <= endTime;
        });
      }

      return results;
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to get audit trail: ${err.message}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get audit entries for a specific key
   */
  async getAuditForKey(
    taskId: string,
    key: string,
    limit: number = 100,
  ): Promise<AuditEntry[]> {
    try {
      const entries = await this.getAuditTrail(taskId, { limit });
      return entries.filter((entry) => entry.key === key);
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to get audit for key: ${err.message}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get all conflicts for an agent
   */
  async getConflictsForAgent(
    agentId: string,
    limit: number = 100,
  ): Promise<AuditEntry[]> {
    try {
      const conflictKey = `hvo:audit:by-agent:${agentId}`;
      const entries = await this.redis.lrange(conflictKey, 0, limit - 1);

      return entries
        .map((entry) => JSON.parse(entry) as AuditEntry)
        .reverse()
        .filter((entry) => entry.operation === 'conflict');
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to get agent conflicts: ${err.message}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get agent statistics
   */
  async getAgentStats(agentId: string): Promise<{
    totalOperations: number;
    operationsByType: Record<string, number>;
    conflictCount: number;
    lastActivity: string | null;
  }> {
    try {
      const agentAuditKey = `hvo:audit:by-agent:${agentId}`;
      const entries = await this.redis.lrange(agentAuditKey, 0, -1);

      const operationsByType: Record<string, number> = {
        read: 0,
        write: 0,
        delete: 0,
        conflict: 0,
      };

      let lastActivity: string | null = null;

      for (const entryJson of entries) {
        const entry = JSON.parse(entryJson) as AuditEntry;
        operationsByType[entry.operation]++;
        if (!lastActivity || entry.timestamp > lastActivity) {
          lastActivity = entry.timestamp;
        }
      }

      const conflictCount = parseInt(
        (await this.redis.get(`hvo:audit:agent-conflicts:${agentId}`)) || '0',
        10,
      );

      return {
        totalOperations: entries.length,
        operationsByType,
        conflictCount,
        lastActivity,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to get agent stats: ${err.message}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Clear audit trail for a task (cleanup)
   */
  async clearAuditTrail(taskId: string): Promise<void> {
    try {
      const auditKey = `hvo:audit:${taskId}`;
      await this.redis.del(auditKey);
      this.logger.log(`Cleared audit trail for task ${taskId}`);
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to clear audit trail: ${err.message}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get operation count statistics
   */
  async getOperationStats(taskId: string): Promise<Record<string, number>> {
    try {
      const entries = await this.getAuditTrail(taskId, { limit: 1000 });

      const stats: Record<string, number> = {
        read: 0,
        write: 0,
        delete: 0,
        conflict: 0,
      };

      for (const entry of entries) {
        stats[entry.operation]++;
      }

      return stats;
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to get operation stats: ${err.message}`,
        error,
      );
      throw error;
    }
  }
}
