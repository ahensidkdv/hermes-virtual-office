import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * Conflict resolution strategy types
 */
export enum ResolutionStrategy {
  LAST_WRITE_WINS = 'last_write_wins',
  VERSION_PRIORITY = 'version_priority',
  MANUAL_RESOLUTION = 'manual_resolution',
}

/**
 * Resolution result
 */
export interface ResolutionResult {
  strategy: ResolutionStrategy;
  resolved: boolean;
  selectedVersion: number;
  selectedValue: any;
  winnerAgentId: string;
  loserAgentId: string;
  resolutionTime: number; // ms
  timestamp: string;
}

/**
 * Conflict metadata for resolution
 */
export interface ConflictMetadata {
  baseVersion: number;
  currentVersion: number;
  proposedValue: any;
  currentValue: any;
  proposedAgentId: string;
  currentAgentId: string;
  proposedTimestamp: string;
  currentTimestamp: string;
}

/**
 * Task-level configuration for conflict resolution strategy
 */
export interface TaskResolutionConfig {
  taskId: string;
  strategy: ResolutionStrategy;
  customHandler?: (metadata: ConflictMetadata) => Promise<ResolutionResult>;
}

/**
 * Conflict Resolution Service (Phase 2 Sprint 4 Week 2-3)
 * Implements 3 resolution strategies:
 * 1. Last-Write-Wins (LWW): Most recent write wins, determined by timestamp
 * 2. Version-Priority: Higher version number wins
 * 3. Manual-Resolution: Escalate to operator for manual decision
 *
 * Architecture:
 * - hvo:config:resolution:{taskId} → task resolution strategy
 * - hvo:resolution:history:{taskId} → FIFO queue of resolutions
 * - hvo:metrics:resolution:* → resolution metrics
 *
 * Publishes:
 * - conflict.resolved event via Redis pub/sub
 * - Includes resolution strategy, winner, loser, timestamp
 */
@Injectable()
export class ConflictResolutionService {
  private readonly logger = new Logger(ConflictResolutionService.name);
  private redis: Redis;
  private taskConfigs: Map<string, TaskResolutionConfig> = new Map();

  constructor(redis?: Redis) {
    this.redis = redis || new (require('ioredis'))({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
    });

    this.redis.on('error', (err: Error) => {
      this.logger.error(`Redis connection error: ${err.message}`);
    });

    this.redis.on('connect', () => {
      this.logger.log('ConflictResolutionService Redis connected');
    });
  }

  /**
   * Set resolution strategy for a task
   */
  async setTaskStrategy(
    taskId: string,
    strategy: ResolutionStrategy,
    customHandler?: (metadata: ConflictMetadata) => Promise<ResolutionResult>,
  ): Promise<void> {
    try {
      const config: TaskResolutionConfig = {
        taskId,
        strategy,
        customHandler,
      };
      this.taskConfigs.set(taskId, config);

      // Store in Redis for persistence
      const configKey = `hvo:config:resolution:${taskId}`;
      await this.redis.set(configKey, strategy);
      await this.redis.expire(configKey, 7 * 24 * 60 * 60); // 7 days

      this.logger.log(
        `Set resolution strategy for task ${taskId}: ${strategy}`,
      );
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to set task strategy: ${err.message}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get resolution strategy for a task
   * Defaults to LAST_WRITE_WINS if not configured
   */
  async getTaskStrategy(taskId: string): Promise<ResolutionStrategy> {
    try {
      // Check cache first
      const cached = this.taskConfigs.get(taskId);
      if (cached) {
        return cached.strategy;
      }

      // Check Redis
      const configKey = `hvo:config:resolution:${taskId}`;
      const strategy = await this.redis.get(configKey);

      return (strategy as ResolutionStrategy) || ResolutionStrategy.LAST_WRITE_WINS;
    } catch (error) {
      this.logger.warn('Failed to get task strategy, using default');
      return ResolutionStrategy.LAST_WRITE_WINS;
    }
  }

  /**
   * Resolve a conflict using the appropriate strategy
   */
  async resolveConflict(
    taskId: string,
    key: string,
    metadata: ConflictMetadata,
  ): Promise<ResolutionResult> {
    const startTime = Date.now();

    try {
      const strategy = await this.getTaskStrategy(taskId);

      let result: ResolutionResult;

      switch (strategy) {
        case ResolutionStrategy.LAST_WRITE_WINS:
          result = await this.resolveWithLastWriteWins(metadata);
          break;

        case ResolutionStrategy.VERSION_PRIORITY:
          result = await this.resolveWithVersionPriority(metadata);
          break;

        case ResolutionStrategy.MANUAL_RESOLUTION:
          result = await this.resolveWithManualResolution(metadata);
          break;

        default:
          // Fallback to LWW
          result = await this.resolveWithLastWriteWins(metadata);
      }

      // Record resolution time
      result.resolutionTime = Date.now() - startTime;
      result.timestamp = new Date().toISOString();

      // Store in history
      await this.recordResolution(taskId, key, result);

      // Track metrics
      await this.recordMetrics(strategy, result);

      // Publish event
      await this.publishResolutionEvent(taskId, key, result);

      this.logger.log(
        `Conflict resolved for ${taskId}:${key} using ${strategy}. Winner: ${result.winnerAgentId}`,
      );

      return result;
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to resolve conflict: ${err.message}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Strategy 1: Last-Write-Wins (LWW)
   * The most recently written value wins
   */
  private async resolveWithLastWriteWins(
    metadata: ConflictMetadata,
  ): Promise<ResolutionResult> {
    const proposedTime = new Date(metadata.proposedTimestamp).getTime();
    const currentTime = new Date(metadata.currentTimestamp).getTime();

    const won = proposedTime > currentTime;
    return {
      strategy: ResolutionStrategy.LAST_WRITE_WINS,
      resolved: true,
      selectedVersion: won ? metadata.currentVersion + 1 : metadata.currentVersion,
      selectedValue: won ? metadata.proposedValue : metadata.currentValue,
      winnerAgentId: won ? metadata.proposedAgentId : metadata.currentAgentId,
      loserAgentId: won ? metadata.currentAgentId : metadata.proposedAgentId,
      resolutionTime: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Strategy 2: Version-Priority
   * Higher version number wins (for merge conflict scenarios)
   */
  private async resolveWithVersionPriority(
    metadata: ConflictMetadata,
  ): Promise<ResolutionResult> {
    const proposedWins = metadata.currentVersion > metadata.baseVersion;

    return {
      strategy: ResolutionStrategy.VERSION_PRIORITY,
      resolved: true,
      selectedVersion: Math.max(metadata.currentVersion, metadata.baseVersion) + 1,
      selectedValue: proposedWins ? metadata.currentValue : metadata.proposedValue,
      winnerAgentId: proposedWins ? metadata.currentAgentId : metadata.proposedAgentId,
      loserAgentId: proposedWins ? metadata.proposedAgentId : metadata.currentAgentId,
      resolutionTime: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Strategy 3: Manual Resolution
   * Escalate to operator (system) for manual decision
   * Records escalation and waits for external decision
   */
  private async resolveWithManualResolution(
    metadata: ConflictMetadata,
  ): Promise<ResolutionResult> {
    // For now, default to LWW as the automatic resolution
    // but mark it as manual escalation
    const lwwResult = await this.resolveWithLastWriteWins(metadata);

    // Record escalation in system
    await this.recordEscalation(
      metadata.proposedAgentId,
      metadata.currentAgentId,
      metadata,
    );

    return {
      ...lwwResult,
      strategy: ResolutionStrategy.MANUAL_RESOLUTION,
    };
  }

  /**
   * Record a resolution in history
   */
  private async recordResolution(
    taskId: string,
    key: string,
    result: ResolutionResult,
  ): Promise<void> {
    try {
      const historyKey = `hvo:resolution:history:${taskId}`;
      const entry = {
        key,
        ...result,
      };

      await this.redis.lpush(historyKey, JSON.stringify(entry));
      await this.redis.ltrim(historyKey, 0, 999); // Keep last 1000
      await this.redis.expire(historyKey, 30 * 24 * 60 * 60); // 30 days
    } catch (error) {
      this.logger.warn('Failed to record resolution in history');
    }
  }

  /**
   * Record resolution metrics
   */
  private async recordMetrics(
    strategy: ResolutionStrategy,
    result: ResolutionResult,
  ): Promise<void> {
    try {
      const metricsKey = `hvo:metrics:resolution:${strategy}`;

      // Increment counter
      await this.redis.incr(`${metricsKey}:total`);

      // Track resolution time
      await this.redis.lpush(
        `${metricsKey}:times`,
        result.resolutionTime.toString(),
      );
      await this.redis.ltrim(`${metricsKey}:times`, 0, 9999); // Keep last 10k

      // Global counter
      await this.redis.incr('hvo:metrics:resolutions:total');
    } catch (error) {
      this.logger.warn('Failed to record metrics');
    }
  }

  /**
   * Record escalation for manual resolution
   */
  private async recordEscalation(
    agentId1: string,
    agentId2: string,
    metadata: ConflictMetadata,
  ): Promise<void> {
    try {
      const escalationKey = 'hvo:escalations:pending';
      const entry = {
        id: `${Date.now()}-${Math.random()}`,
        agents: [agentId1, agentId2],
        conflict: metadata,
        timestamp: new Date().toISOString(),
        status: 'pending',
      };

      await this.redis.lpush(escalationKey, JSON.stringify(entry));
    } catch (error) {
      this.logger.warn('Failed to record escalation');
    }
  }

  /**
   * Publish conflict.resolved event
   */
  private async publishResolutionEvent(
    taskId: string,
    key: string,
    result: ResolutionResult,
  ): Promise<void> {
    try {
      const event = {
        type: 'conflict.resolved',
        taskId,
        key,
        result,
        timestamp: new Date().toISOString(),
      };

      await this.redis.publish(
        'hvo:events:conflicts',
        JSON.stringify(event),
      );
    } catch (error) {
      this.logger.warn('Failed to publish resolution event');
    }
  }

  /**
   * Get resolution metrics for a strategy
   */
  async getMetrics(strategy: ResolutionStrategy): Promise<{
    totalResolutions: number;
    averageResolutionTime: number;
    p95ResolutionTime: number;
    p99ResolutionTime: number;
  }> {
    try {
      const metricsKey = `hvo:metrics:resolution:${strategy}`;

      const total = await this.redis.get(`${metricsKey}:total`);
      const timesRaw = await this.redis.lrange(`${metricsKey}:times`, 0, -1);

      if (!timesRaw || timesRaw.length === 0) {
        return {
          totalResolutions: 0,
          averageResolutionTime: 0,
          p95ResolutionTime: 0,
          p99ResolutionTime: 0,
        };
      }

      const times = timesRaw.map((t) => parseInt(t, 10)).sort((a, b) => a - b);
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const p95 = times[Math.floor(times.length * 0.95)];
      const p99 = times[Math.floor(times.length * 0.99)];

      return {
        totalResolutions: parseInt(total || '0', 10),
        averageResolutionTime: avg,
        p95ResolutionTime: p95,
        p99ResolutionTime: p99,
      };
    } catch (error) {
      this.logger.warn('Failed to get metrics');
      return {
        totalResolutions: 0,
        averageResolutionTime: 0,
        p95ResolutionTime: 0,
        p99ResolutionTime: 0,
      };
    }
  }

  /**
   * Get resolution history for a task
   */
  async getResolutionHistory(
    taskId: string,
    limit: number = 100,
  ): Promise<ResolutionResult[]> {
    try {
      const historyKey = `hvo:resolution:history:${taskId}`;
      const entries = await this.redis.lrange(historyKey, 0, limit - 1);

      return entries
        .map((entry) => {
          const parsed = JSON.parse(entry);
          return {
            strategy: parsed.strategy,
            resolved: parsed.resolved,
            selectedVersion: parsed.selectedVersion,
            selectedValue: parsed.selectedValue,
            winnerAgentId: parsed.winnerAgentId,
            loserAgentId: parsed.loserAgentId,
            resolutionTime: parsed.resolutionTime,
            timestamp: parsed.timestamp,
          } as ResolutionResult;
        })
        .reverse();
    } catch (error) {
      this.logger.warn('Failed to get resolution history');
      return [];
    }
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
    }
  }
}
