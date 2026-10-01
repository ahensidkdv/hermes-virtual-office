import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  Logger,
  UseInterceptors,
} from '@nestjs/common';
import { SharedMemoryService } from '../services/shared-memory.service';
import { ConflictDetectionService } from '../services/conflict-detection.service';
import { AuditTrailService } from '../services/audit-trail.service';

/**
 * Request/Response DTOs
 */
export interface WriteMemoryDto {
  key: string;
  value: any;
  baseVersion: number; // -1 for create new
  agentId: string;
}

export interface MemoryResponse {
  key: string;
  value: any;
  version: number;
  metadata: {
    written_by: string;
    written_at: string;
    read_count: number;
  };
}

export interface MemoryWriteResponse extends MemoryResponse {
  conflict?: {
    baseVersion: number;
    currentVersion: number;
    retryCount: number;
  };
}

/**
 * Shared Memory REST Controller
 * Handles CRUD operations on task-scoped shared memory
 *
 * Endpoints:
 * - GET /api/tasks/{taskId}/memory → list all keys
 * - GET /api/tasks/{taskId}/memory/{key} → read single key
 * - POST /api/tasks/{taskId}/memory → write key
 * - DELETE /api/tasks/{taskId}/memory/{key} → delete key
 *
 * All operations are logged to audit trail
 */
@Controller('api/tasks/:taskId/memory')
export class SharedMemoryController {
  private readonly logger = new Logger(SharedMemoryController.name);

  constructor(
    private readonly sharedMemoryService: SharedMemoryService,
    private readonly conflictService: ConflictDetectionService,
    private readonly auditService: AuditTrailService,
  ) {}

  /**
   * GET /api/tasks/{taskId}/memory
   * List all shared memory keys for a task
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async getAll(
    @Param('taskId') taskId: string,
  ): Promise<{
    taskId: string;
    keys: MemoryResponse[];
    count: number;
  }> {
    try {
      this.logger.debug(`Getting all memory keys for task ${taskId}`);

      const entries = await this.sharedMemoryService.getAll(taskId);

      return {
        taskId,
        keys: entries,
        count: entries.length,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to get all memory keys: ${err.message}`,
        error,
      );
      throw error;
    }
  }

  /**
   * GET /api/tasks/{taskId}/memory/{key}
   * Read a single shared memory key
   */
  @Get(':key')
  @HttpCode(HttpStatus.OK)
  async read(
    @Param('taskId') taskId: string,
    @Param('key') key: string,
  ): Promise<MemoryResponse> {
    try {
      this.logger.debug(`Reading memory key ${key} for task ${taskId}`);

      const entry = await this.sharedMemoryService.read(taskId, key);

      // Log read access (async, no need to await)
      this.auditService.logReadAccess(taskId, key, 'api-client').catch(() => {
        // Ignore audit logging errors
      });

      return entry;
    } catch (error) {
      const err = error as Error;
      if (err.message.includes('not found')) {
        throw new NotFoundException(`Key ${key} not found in task ${taskId}`);
      }
      this.logger.error(
        `Failed to read memory key ${key}: ${err.message}`,
        error,
      );
      throw error;
    }
  }

  /**
   * POST /api/tasks/{taskId}/memory
   * Write to shared memory with optimistic locking
   *
   * Body: { key, value, baseVersion, agentId }
   * baseVersion: -1 for new key, or the current version for updates
   *
   * Returns 409 Conflict if version mismatch after retries
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async write(
    @Param('taskId') taskId: string,
    @Body() dto: WriteMemoryDto,
  ): Promise<MemoryWriteResponse> {
    try {
      const { key, value, baseVersion, agentId } = dto;

      if (!key || value === undefined || !agentId) {
        throw new BadRequestException(
          'Missing required fields: key, value, agentId',
        );
      }

      this.logger.debug(
        `Writing memory key ${key} for task ${taskId} (version: ${baseVersion})`,
      );

      try {
        const entry = await this.sharedMemoryService.write(
          taskId,
          key,
          value,
          baseVersion,
          agentId,
        );

        // Log write access (async)
        this.auditService
          .logWriteAccess(taskId, key, agentId, entry.version, value)
          .catch(() => {
            // Ignore audit logging errors
          });

        return entry;
      } catch (error) {
        const err = error as any;
        if (
          err.message &&
          err.message.includes('MAX_RETRIES_EXCEEDED')
        ) {
          // Return 409 Conflict
          const conflict = err.conflict || {};
          this.logger.warn(
            `Write conflict for ${taskId}:${key}, max retries exceeded`,
          );

          // Log conflict
          this.auditService
            .logConflict(
              taskId,
              key,
              agentId,
              conflict.baseVersion || baseVersion,
              conflict.currentVersion || 0,
              {
                maxRetriesExceeded: true,
                retryCount: conflict.retryCount || 3,
              },
            )
            .catch(() => {
              // Ignore
            });

          // Return the conflict response with 409 status
          throw new BadRequestException({
            message: 'Write conflict: max retries exceeded',
            code: 'CONFLICT_MAX_RETRIES',
            conflict,
          });
        }
        throw error;
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to write memory: ${err.message}`, error);
      throw error;
    }
  }

  /**
   * DELETE /api/tasks/{taskId}/memory/{key}
   * Delete a shared memory key
   */
  @Delete(':key')
  @HttpCode(HttpStatus.OK)
  async delete(
    @Param('taskId') taskId: string,
    @Param('key') key: string,
  ): Promise<{ taskId: string; key: string; deleted: boolean }> {
    try {
      this.logger.debug(`Deleting memory key ${key} for task ${taskId}`);

      await this.sharedMemoryService.delete(taskId, key);

      // Log delete access (async)
      this.auditService.logDeleteAccess(taskId, key, 'api-client').catch(() => {
        // Ignore audit logging errors
      });

      return {
        taskId,
        key,
        deleted: true,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to delete memory key ${key}: ${err.message}`,
        error,
      );
      throw error;
    }
  }
}
