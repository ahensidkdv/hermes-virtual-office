import { Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Task } from '../entities/task.entity';

/**
 * CloudEvent model compliant with CloudEvents spec v1.0
 * https://cloudevents.io/
 */
export interface CloudEvent {
  specversion: '1.0';
  type: string;
  source: string;
  id: string;
  time: string;
  datacontenttype: string;
  data: Record<string, any>;
}

/**
 * Cloud Event Service
 * Publishes domain events to Redis in CloudEvents format
 * Channel: 'hvo:events'
 */
@Injectable()
export class CloudEventService {
  private readonly logger = new Logger(CloudEventService.name);
  private redis: Redis;

  constructor() {
    this.redis = new (require('ioredis'))({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
    });

    this.redis.on('error', (err: Error) => {
      this.logger.error(`Redis connection error: ${err.message}`);
    });

    this.redis.on('connect', () => {
      this.logger.log('Redis connected');
    });
  }

  /**
   * Publish task.created event
   * Triggers Manager Agent to decompose task into subtasks
   */
  async publishTaskCreated(task: Task): Promise<void> {
    const event: CloudEvent = {
      specversion: '1.0',
      type: 'hvo.task.created',
      source: 'hvo/tasks-service',
      id: `${task.id}-${Date.now()}`,
      time: new Date().toISOString(),
      datacontenttype: 'application/json',
      data: {
        task_id: task.id,
        title: task.title,
        priority: task.priority,
        description: task.description,
        created_at: task.created_at.toISOString(),
      },
    };

    await this.publishEvent('hvo:events', event);
  }

  /**
   * Publish task.status.changed event
   */
  async publishTaskStatusChanged(task: Task): Promise<void> {
    const event: CloudEvent = {
      specversion: '1.0',
      type: 'hvo.task.status.changed',
      source: 'hvo/tasks-service',
      id: `${task.id}-${Date.now()}`,
      time: new Date().toISOString(),
      datacontenttype: 'application/json',
      data: {
        task_id: task.id,
        status: task.status,
        updated_at: task.updated_at.toISOString(),
      },
    };

    await this.publishEvent('hvo:events', event);
  }

  /**
   * Internal method to publish event to Redis
   */
  private async publishEvent(channel: string, event: CloudEvent): Promise<void> {
    try {
      await this.redis.publish(channel, JSON.stringify(event));
      this.logger.debug(`Event published: ${event.type} (${event.id})`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to publish event: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Publish agent.online event
   */
  async publishAgentOnline(agentId: string): Promise<void> {
    const event: CloudEvent = {
      specversion: '1.0',
      type: 'hvo.agent.online',
      source: 'hvo/heartbeat-service',
      id: `${agentId}-${Date.now()}`,
      time: new Date().toISOString(),
      datacontenttype: 'application/json',
      data: {
        agent_id: agentId,
        status: 'online',
      },
    };

    await this.publishEvent('hvo:events', event);
  }

  /**
   * Publish agent.offline event
   */
  async publishAgentOffline(agentId: string): Promise<void> {
    const event: CloudEvent = {
      specversion: '1.0',
      type: 'hvo.agent.offline',
      source: 'hvo/heartbeat-service',
      id: `${agentId}-${Date.now()}`,
      time: new Date().toISOString(),
      datacontenttype: 'application/json',
      data: {
        agent_id: agentId,
        status: 'offline',
      },
    };

    await this.publishEvent('hvo:events', event);
  }

  /**
   * Publish alert.created event
   */
  async publishAlertCreated(
    alertId: string,
    agentId: string,
    level: string,
  ): Promise<void> {
    const event: CloudEvent = {
      specversion: '1.0',
      type: 'hvo.alert.created',
      source: 'hvo/alert-service',
      id: `${alertId}-${Date.now()}`,
      time: new Date().toISOString(),
      datacontenttype: 'application/json',
      data: {
        alert_id: alertId,
        agent_id: agentId,
        level,
      },
    };

    await this.publishEvent('hvo:events', event);
  }

  /**
   * Publish alert.escalated event
   */
  async publishAlertEscalated(
    alertId: string,
    agentId: string,
    newLevel: string,
    escalationCount: number,
  ): Promise<void> {
    const event: CloudEvent = {
      specversion: '1.0',
      type: 'hvo.alert.escalated',
      source: 'hvo/alert-service',
      id: `${alertId}-escalated-${Date.now()}`,
      time: new Date().toISOString(),
      datacontenttype: 'application/json',
      data: {
        alert_id: alertId,
        agent_id: agentId,
        level: newLevel,
        escalation_count: escalationCount,
      },
    };

    await this.publishEvent('hvo:events', event);
  }

  /**
   * Publish alert.resolved event
   */
  async publishAlertResolved(alertId: string, agentId: string): Promise<void> {
    const event: CloudEvent = {
      specversion: '1.0',
      type: 'hvo.alert.resolved',
      source: 'hvo/alert-service',
      id: `${alertId}-resolved-${Date.now()}`,
      time: new Date().toISOString(),
      datacontenttype: 'application/json',
      data: {
        alert_id: alertId,
        agent_id: agentId,
      },
    };

    await this.publishEvent('hvo:events', event);
  }

  /**
   * Cleanup Redis connection
   */
  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
