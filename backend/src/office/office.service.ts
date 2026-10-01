import { Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * Office Service
 * Manages WebSocket broadcasts and agent position updates
 * Publishes events to Redis for WebSocket gateway to consume
 */
@Injectable()
export class OfficeService {
  private readonly logger = new Logger(OfficeService.name);
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
  }

  /**
   * Broadcast agent:move event to all connected WebSocket clients
   * Latency < 500ms requirement via Redis pub/sub
   */
  async broadcastAgentMove(
    agentId: string,
    position_x: number,
    position_y: number,
    room: string,
  ): Promise<void> {
    const event = {
      type: 'agent:move',
      agentId,
      position_x,
      position_y,
      room,
      timestamp: new Date().toISOString(),
    };

    try {
      await this.redis.publish('hvo:office:events', JSON.stringify(event));
      this.logger.debug(`Broadcast agent:move for ${agentId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to broadcast agent:move: ${errorMessage}`);
    }
  }

  /**
   * Broadcast agent:status event to all connected WebSocket clients
   */
  async broadcastAgentStatus(agentId: string, status: string): Promise<void> {
    const event = {
      type: 'agent:status',
      agentId,
      status,
      timestamp: new Date().toISOString(),
    };

    try {
      await this.redis.publish('hvo:office:events', JSON.stringify(event));
      this.logger.debug(`Broadcast agent:status for ${agentId}: ${status}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to broadcast agent:status: ${errorMessage}`);
    }
  }

  /**
   * Broadcast task:assigned event to all connected WebSocket clients
   * Triggered when manager agent assigns task to worker agent
   */
  async broadcastTaskAssigned(
    taskId: string,
    agentId: string,
    subtaskCount: number,
  ): Promise<void> {
    const event = {
      type: 'task:assigned',
      taskId,
      agentId,
      subtaskCount,
      timestamp: new Date().toISOString(),
    };

    try {
      await this.redis.publish('hvo:office:events', JSON.stringify(event));
      this.logger.debug(`Broadcast task:assigned: task=${taskId}, agent=${agentId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to broadcast task:assigned: ${errorMessage}`);
    }
  }

  /**
   * Get agent position from Redis cache (fast lookup)
   */
  async getAgentPosition(
    agentId: string,
  ): Promise<{
    position_x: number;
    position_y: number;
    room: string;
  } | null> {
    try {
      const data = await this.redis.hgetall(`hvo:agent:${agentId}`);
      if (Object.keys(data).length === 0) {
        return null;
      }

      return {
        position_x: parseFloat(data.position_x),
        position_y: parseFloat(data.position_y),
        room: data.room,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get agent position: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Cleanup Redis connection
   */
  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
