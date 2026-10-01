import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * Shared Memory Entry with version and metadata
 */
export interface SharedMemoryEntry {
  key: string;
  value: any;
  version: number;
  metadata: {
    written_by: string;
    written_at: string;
    read_count: number;
  };
}

/**
 * Shared Memory Service (Phase 2 Sprint 4 Week 1)
 * Implements optimistic locking for task-scoped shared memory
 *
 * Architecture:
 * - Task-scoped namespace: hvo:task:{taskId}:shared:{key}
 * - Versioning: hvo:task:{taskId}:versions:{key}
 * - Metadata: hvo:task:{taskId}:metadata:{key}
 * - Read count: hvo:task:{taskId}:read-counts:{key}
 *
 * Optimistic Locking:
 * - CAS (Compare-And-Swap) on write using watch/multi/exec
 * - If current version != baseVersion, return conflict error
 * - Automatic retry with exponential backoff (100ms, 200ms, 400ms)
 * - Max 3 retries, then escalate
 */
@Injectable()
export class SharedMemoryService {
  private readonly logger = new Logger(SharedMemoryService.name);
  private redis: Redis;

  // Retry configuration
  private readonly maxRetries = 3;
  private readonly retryDelays = [100, 200, 400]; // ms

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
      this.logger.log('SharedMemoryService Redis connected');
    });
  }

  /**
   * Read a value from shared memory
   * Increments read_count and returns latest version
   */
  async read(taskId: string, key: string): Promise<SharedMemoryEntry> {
    const valueKey = `hvo:task:${taskId}:shared:${key}`;
    const versionKey = `hvo:task:${taskId}:versions:${key}`;
    const metadataKey = `hvo:task:${taskId}:metadata:${key}`;
    const readCountKey = `hvo:task:${taskId}:read-counts:${key}`;

    const [value, version, metadata] = await Promise.all([
      this.redis.get(valueKey),
      this.redis.get(versionKey),
      this.redis.get(metadataKey),
    ]);

    // Increment read count
    await this.redis.incr(readCountKey);

    if (!value || !version) {
      throw new BadRequestException(
        `Key ${key} not found in task ${taskId} shared memory`,
      );
    }

    const readCountStr = await this.redis.get(readCountKey);
    const readCount = parseInt(readCountStr || '1', 10) || 1;
    const parsedValue = JSON.parse(value);
    const parsedMetadata = metadata ? JSON.parse(metadata) : {};
    const versionNum = parseInt(version, 10);

    return {
      key,
      value: parsedValue,
      version: versionNum,
      metadata: {
        written_by: parsedMetadata.written_by || 'unknown',
        written_at: parsedMetadata.written_at || new Date().toISOString(),
        read_count: readCount,
      },
    };
  }

  /**
   * Write a value to shared memory with CAS (Compare-And-Swap)
   * Uses Redis WATCH/MULTI/EXEC for atomic operation
   *
   * Returns conflict error if current version != baseVersion
   * On success, increments version and updates metadata
   */
  async write(
    taskId: string,
    key: string,
    value: any,
    baseVersion: number,
    agentId: string,
    retryCount: number = 0,
  ): Promise<SharedMemoryEntry> {
    const valueKey = `hvo:task:${taskId}:shared:${key}`;
    const versionKey = `hvo:task:${taskId}:versions:${key}`;
    const metadataKey = `hvo:task:${taskId}:metadata:${key}`;
    const readCountKey = `hvo:task:${taskId}:read-counts:${key}`;

    try {
      const currentReadCountStr = await this.redis.get(readCountKey);
      const currentReadCount = parseInt(currentReadCountStr || '0', 10) || 0;
      const timestamp = new Date().toISOString();

      // Get current version
      let currentVersion: number;
      try {
        const versionStr = await this.redis.get(versionKey);
        currentVersion = versionStr ? parseInt(versionStr, 10) : 0;
      } catch (error) {
        currentVersion = 0;
      }

      // CAS check: baseVersion must match currentVersion
      // Special case: baseVersion = -1 means new key (only if version doesn't exist)
      if (baseVersion !== -1 && currentVersion !== baseVersion) {
        // Conflict detected
        if (retryCount < this.maxRetries) {
          const delay = this.retryDelays[retryCount];
          this.logger.warn(
            `Write conflict for ${taskId}:${key} (v${baseVersion} vs v${currentVersion}), retry ${retryCount + 1}/${this.maxRetries} after ${delay}ms`,
          );

          // Wait for backoff period
          await new Promise((resolve) => setTimeout(resolve, delay));

          // Re-read latest version and retry
          const latest = await this.read(taskId, key);
          return this.write(
            taskId,
            key,
            value,
            latest.version,
            agentId,
            retryCount + 1,
          );
        } else {
          // Max retries exceeded
          const errorMsg = `Write failed for ${taskId}:${key}: max retries (3) exceeded, version conflict (base: ${baseVersion}, current: ${currentVersion})`;
          this.logger.error(errorMsg);
          throw new BadRequestException({
            message: errorMsg,
            code: 'MAX_RETRIES_EXCEEDED',
            conflict: {
              baseVersion,
              currentVersion,
              retryCount,
            },
          });
        }
      }

      // If baseVersion is -1 and version already exists, fail
      if (baseVersion === -1 && currentVersion !== 0) {
        if (retryCount < this.maxRetries) {
          const delay = this.retryDelays[retryCount];
          this.logger.warn(
            `Write conflict for new key ${taskId}:${key} (already exists at v${currentVersion}), retry ${retryCount + 1}/${this.maxRetries} after ${delay}ms`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          return this.write(
            taskId,
            key,
            value,
            -1,
            agentId,
            retryCount + 1,
          );
        } else {
          const errorMsg = `Create failed for ${taskId}:${key}: max retries (3) exceeded, key already exists`;
          this.logger.error(errorMsg);
          throw new BadRequestException({
            message: errorMsg,
            code: 'MAX_RETRIES_EXCEEDED',
            conflict: {
              baseVersion,
              currentVersion,
              retryCount,
            },
          });
        }
      }

      // Atomic write: increment version only if not new key
      const newVersion = baseVersion === -1 ? 0 : currentVersion + 1;
      await Promise.all([
        this.redis.set(valueKey, JSON.stringify(value)),
        this.redis.set(versionKey, newVersion.toString()),
        this.redis.set(
          metadataKey,
          JSON.stringify({
            written_by: agentId,
            written_at: timestamp,
            read_count: currentReadCount,
          }),
        ),
      ]);

      const parsedValue = JSON.parse(JSON.stringify(value));

      this.logger.debug(
        `Write success: ${taskId}:${key} v${baseVersion} -> v${newVersion} (agent: ${agentId})`,
      );

      return {
        key,
        value: parsedValue,
        version: newVersion,
        metadata: {
          written_by: agentId,
          written_at: timestamp,
          read_count: currentReadCount,
        },
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Write error for ${taskId}:${key}: ${err.message}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Delete a key from shared memory (versioned)
   * Also removes version, metadata, and read count
   */
  async delete(taskId: string, key: string): Promise<void> {
    const valueKey = `hvo:task:${taskId}:shared:${key}`;
    const versionKey = `hvo:task:${taskId}:versions:${key}`;
    const metadataKey = `hvo:task:${taskId}:metadata:${key}`;
    const readCountKey = `hvo:task:${taskId}:read-counts:${key}`;

    try {
      await Promise.all([
        this.redis.del(valueKey),
        this.redis.del(versionKey),
        this.redis.del(metadataKey),
        this.redis.del(readCountKey),
      ]);

      this.logger.debug(`Deleted key ${key} from task ${taskId} shared memory`);
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Delete error for ${taskId}:${key}: ${err.message}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get all keys for a task's shared memory
   */
  async getAll(taskId: string): Promise<SharedMemoryEntry[]> {
    try {
      const pattern = `hvo:task:${taskId}:shared:*`;
      const keys = await this.redis.keys(pattern);

      const entries: SharedMemoryEntry[] = [];

      for (const key of keys) {
        const match = key.match(`hvo:task:${taskId}:shared:(.*)`);
        if (match) {
          const k = match[1];
          try {
            const entry = await this.read(taskId, k);
            entries.push(entry);
          } catch (err) {
            const e = err as Error;
            this.logger.warn(`Failed to read key ${k}: ${e.message}`);
          }
        }
      }

      return entries;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`GetAll error for task ${taskId}: ${err.message}`, error);
      throw error;
    }
  }

  /**
   * Create a new key in shared memory (version starts at 0)
   */
  async create(
    taskId: string,
    key: string,
    value: any,
    agentId: string,
  ): Promise<SharedMemoryEntry> {
    return this.write(taskId, key, value, -1, agentId);
  }

  /**
   * Get the current version of a key without reading the value
   */
  async getVersion(taskId: string, key: string): Promise<number> {
    const versionKey = `hvo:task:${taskId}:versions:${key}`;
    const version = await this.redis.get(versionKey);
    return parseInt(version || '0', 10);
  }

  /**
   * Clean up shared memory for a task (delete all keys)
   * Used for task cleanup/archival
   */
  async cleanupTask(taskId: string): Promise<number> {
    try {
      const pattern = `hvo:task:${taskId}:*`;
      const keys = await this.redis.keys(pattern);

      if (keys.length > 0) {
        await this.redis.del(...keys);
      }

      this.logger.log(`Cleaned up ${keys.length} keys for task ${taskId}`);
      return keys.length;
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Cleanup error for task ${taskId}: ${err.message}`,
        error,
      );
      throw error;
    }
  }
}
