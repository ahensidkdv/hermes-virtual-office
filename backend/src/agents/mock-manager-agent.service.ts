import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { TasksService } from '../tasks/tasks.service';
import { CloudEvent } from '../events/cloud-event.service';

/**
 * Mock Manager Agent
 * - Subscribes to task.created CloudEvents
 * - Decomposes tasks into 2-4 subtasks
 * - Updates parent task status: created → assigned
 * - Respects max 7 concurrent agents (queue remaining subtasks)
 * - Publishes status updates to Redis
 *
 * Phase 0: In-memory mock (Phase 2: Real Hermes integration)
 */
@Injectable()
export class MockManagerAgent implements OnModuleInit {
  private readonly logger = new Logger(MockManagerAgent.name);
  private redis: Redis;
  private subscriber: Redis;
  private concurrentAgents = 0;
  private readonly maxConcurrentAgents = 7;
  private taskQueue: string[] = [];

  constructor(private tasksService: TasksService) {
    // Main Redis client for publishing
    this.redis = new (require('ioredis'))({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
    });

    // Separate subscriber client (Pub/Sub)
    this.subscriber = new (require('ioredis'))({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
    });
  }

  /**
   * Initialize the mock manager agent
   * Subscribe to task.created events on Redis
   */
  async onModuleInit(): Promise<void> {
    try {
      // Subscribe to CloudEvents on hvo:events channel
      await this.subscriber.subscribe('hvo:events');
      this.logger.log('Subscribed to hvo:events channel');

      // Listen for messages
      this.subscriber.on('message', async (channel: string, message: string) => {
        if (channel === 'hvo:events') {
          try {
            const event = JSON.parse(message) as CloudEvent;
            if (event.type === 'hvo.task.created') {
              await this.handleTaskCreated(event);
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to parse event: ${errorMessage}`);
          }
        }
      });

      this.logger.log('MockManagerAgent initialized and listening for task.created events');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to initialize MockManagerAgent: ${errorMessage}`);
    }
  }

  /**
   * Handle task.created event
   * Decompose task into 2-4 subtasks
   */
  private async handleTaskCreated(event: CloudEvent): Promise<void> {
    const taskId = event.data.task_id as string;
    const title = event.data.title as string;

    this.logger.log(`Processing task.created event: ${taskId} - ${title}`);

    // Check concurrent agent limit
    if (this.concurrentAgents >= this.maxConcurrentAgents) {
      this.logger.warn(
        `Max concurrent agents (${this.maxConcurrentAgents}) reached. Queuing task ${taskId}`,
      );
      this.taskQueue.push(taskId);
      return;
    }

    // Process decomposition
    await this.decomposeTask(taskId, title);
  }

  /**
   * Decompose a task into 2-4 subtasks
   * Mock decomposition strategy: split task title into subtasks
   */
  private async decomposeTask(taskId: string, taskTitle: string): Promise<void> {
    this.concurrentAgents++;

    try {
      // Generate 3 subtasks (variable 2-4)
      const subtaskCount = Math.floor(Math.random() * 3) + 2; // 2-4 subtasks
      const subtaskTitles = this.generateSubtaskTitles(taskTitle, subtaskCount);

      this.logger.log(`Decomposing task ${taskId} into ${subtaskCount} subtasks`);

      // Create subtasks in database
      const subtasks = await this.tasksService.createSubtasks(taskId, subtaskTitles);

      // Update parent task status: created → assigned
      await this.tasksService.updateTaskStatus(taskId, { status: 'assigned' });

      // Publish task.assigned event (for WebSocket broadcast)
      await this.publishTaskAssigned(taskId, subtasks.length);

      this.logger.log(`Task ${taskId} decomposed successfully into ${subtasks.length} subtasks`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to decompose task ${taskId}: ${errorMessage}`);
    } finally {
      this.concurrentAgents--;

      // Process queued tasks if available
      if (this.taskQueue.length > 0 && this.concurrentAgents < this.maxConcurrentAgents) {
        const nextTaskId = this.taskQueue.shift();
        if (nextTaskId) {
          // Retrieve task from database to get title
          const task = await this.tasksService.getTask(nextTaskId);
          await this.decomposeTask(nextTaskId, task.title);
        }
      }
    }
  }

  /**
   * Generate subtask titles from parent task title
   * Mock strategy: simple decomposition
   */
  private generateSubtaskTitles(parentTitle: string, count: number): string[] {
    const keywords = parentTitle.toLowerCase().split(' ').slice(0, 3);
    const subtasks: string[] = [];

    const strategies = [
      `Research and analysis of ${keywords.slice(0, 2).join(' ')}`,
      `Data collection for ${keywords.slice(1, 3).join(' ')}`,
      `Synthesis and recommendations`,
      `Validation and review`,
    ];

    for (let i = 0; i < Math.min(count, strategies.length); i++) {
      subtasks.push(strategies[i]);
    }

    return subtasks;
  }

  /**
   * Publish task.assigned event to Redis
   * Used for WebSocket real-time broadcast
   */
  private async publishTaskAssigned(taskId: string, subtaskCount: number): Promise<void> {
    const event: CloudEvent = {
      specversion: '1.0',
      type: 'hvo.task.assigned',
      source: 'hvo/manager-agent',
      id: `${taskId}-assigned-${Date.now()}`,
      time: new Date().toISOString(),
      datacontenttype: 'application/json',
      data: {
        task_id: taskId,
        status: 'assigned',
        subtask_count: subtaskCount,
        assigned_at: new Date().toISOString(),
      },
    };

    try {
      await this.redis.publish('hvo:events', JSON.stringify(event));
      this.logger.debug(`Published task.assigned event for ${taskId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to publish task.assigned event: ${errorMessage}`);
    }
  }

  /**
   * Cleanup connections on module destroy
   */
  async onModuleDestroy(): Promise<void> {
    await this.subscriber.unsubscribe();
    await this.subscriber.quit();
    await this.redis.quit();
  }
}
