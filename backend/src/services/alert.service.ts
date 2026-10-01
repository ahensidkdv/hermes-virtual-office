import { Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { CloudEventService } from '../events/cloud-event.service';

/**
 * Alert Level Progression
 */
export type AlertLevel = 'info' | 'warning' | 'critical';

/**
 * Alert record
 */
export interface Alert {
  id: string;
  agentId: string;
  level: AlertLevel;
  message: string;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
  escalationCount: number;
  channelsNotified: string[]; // 'log', 'websocket', 'email'
}

/**
 * Alert Service (Phase 2 Week 2)
 * Manages alert lifecycle: creation, escalation, resolution
 * Supports multiple channels: logs, WebSocket, email (future)
 */
@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);
  private redis: Redis;

  // In-memory alert tracking
  private alerts = new Map<string, Alert>();
  private alertHistory: Alert[] = [];
  private maxHistorySize = 1000;

  constructor(private cloudEventService: CloudEventService) {
    this.redis = new (require('ioredis'))({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
    });

    this.redis.on('error', (err: Error) => {
      this.logger.error(`Redis connection error: ${err.message}`);
    });
  }

  /**
   * Create new alert for agent
   * Returns alert ID
   */
  async createAlert(
    agentId: string,
    level: AlertLevel,
    message: string,
  ): Promise<string> {
    const alertId = `alert-${agentId}-${Date.now()}`;
    const now = new Date();

    const alert: Alert = {
      id: alertId,
      agentId,
      level,
      message,
      createdAt: now,
      updatedAt: now,
      escalationCount: 0,
      channelsNotified: [],
    };

    this.alerts.set(alertId, alert);
    this.addToHistory(alert);

    this.logger.log(`Alert created: ${alertId} [${level}] for agent ${agentId}`);

    // Persist to Redis with TTL (24 hours)
    await this.redis.setex(
      `hvo:alert:${alertId}`,
      86400,
      JSON.stringify(alert),
    );

    // Index alert by agent
    await this.redis.lpush(`hvo:alerts:${agentId}`, alertId);

    // Notify via appropriate channels
    await this.notifyChannels(alert, ['log', 'websocket']);

    // Emit CloudEvent for escalation
    await this.cloudEventService.publishAlertCreated(alertId, agentId, level);

    return alertId;
  }

  /**
   * Escalate existing alert to next level
   * info → warning → critical
   */
  async escalateAlert(alertId: string): Promise<void> {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.resolvedAt) {
      this.logger.warn(`Cannot escalate resolved alert: ${alertId}`);
      return;
    }

    const levelProgression: AlertLevel[] = ['info', 'warning', 'critical'];
    const currentIndex = levelProgression.indexOf(alert.level);

    if (currentIndex < levelProgression.length - 1) {
      const newLevel = levelProgression[currentIndex + 1];
      alert.level = newLevel;
      alert.updatedAt = new Date();
      alert.escalationCount++;

      this.alerts.set(alertId, alert);
      this.addToHistory(alert);

      this.logger.warn(
        `Alert escalated: ${alertId} → ${newLevel} (count: ${alert.escalationCount})`,
      );

      // Persist updated alert
      await this.redis.setex(
        `hvo:alert:${alertId}`,
        86400,
        JSON.stringify(alert),
      );

      // Notify on escalation
      await this.notifyChannels(
        { ...alert, message: `Alert escalated to ${newLevel}` },
        ['log', 'websocket'],
      );

      // Emit escalation event
      await this.cloudEventService.publishAlertEscalated(
        alertId,
        alert.agentId,
        newLevel,
        alert.escalationCount,
      );
    } else {
      this.logger.debug(`Alert already at critical level: ${alertId}`);
    }
  }

  /**
   * Resolve alert (clear when agent recovers)
   */
  async resolveAlert(alertId: string): Promise<void> {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.resolvedAt) {
      return;
    }

    alert.resolvedAt = new Date();
    alert.updatedAt = alert.resolvedAt;
    this.alerts.set(alertId, alert);
    this.addToHistory(alert);

    this.logger.log(`Alert resolved: ${alertId} for agent ${alert.agentId}`);

    // Update in Redis
    await this.redis.setex(
      `hvo:alert:${alertId}`,
      86400,
      JSON.stringify(alert),
    );

    // Notify resolution
    await this.notifyChannels(
      { ...alert, message: 'Alert resolved - agent recovered' },
      ['log', 'websocket'],
    );

    // Emit resolution event
    await this.cloudEventService.publishAlertResolved(
      alertId,
      alert.agentId,
    );
  }

  /**
   * Get active alerts for agent
   */
  getAgentAlerts(agentId: string): Alert[] {
    return Array.from(this.alerts.values()).filter(
      (alert) => alert.agentId === agentId && !alert.resolvedAt,
    );
  }

  /**
   * Get highest level alert for agent
   */
  getHighestAlertLevel(agentId: string): AlertLevel | null {
    const agentAlerts = this.getAgentAlerts(agentId);
    if (agentAlerts.length === 0) return null;

    const levelOrder: Record<AlertLevel, number> = {
      info: 1,
      warning: 2,
      critical: 3,
    };

    return agentAlerts.reduce((max, current) =>
      levelOrder[current.level] > levelOrder[max.level] ? current : max,
    ).level;
  }

  /**
   * Get all active alerts
   */
  getAllActiveAlerts(): Alert[] {
    return Array.from(this.alerts.values()).filter((alert) => !alert.resolvedAt);
  }

  /**
   * Get alert history (last N entries)
   */
  getAlertHistory(limit: number = 100): Alert[] {
    return this.alertHistory.slice(-limit);
  }

  /**
   * Get alert summary
   */
  getAlertSummary(): {
    total: number;
    byLevel: Record<AlertLevel, number>;
    agents: Record<string, AlertLevel | null>;
  } {
    const activeAlerts = this.getAllActiveAlerts();
    const summary = {
      total: activeAlerts.length,
      byLevel: {
        info: 0,
        warning: 0,
        critical: 0,
      },
      agents: {} as Record<string, AlertLevel | null>,
    };

    for (const alert of activeAlerts) {
      summary.byLevel[alert.level]++;
      const currentLevel = summary.agents[alert.agentId];
      if (
        !currentLevel ||
        this.isHigherLevel(alert.level, currentLevel)
      ) {
        summary.agents[alert.agentId] = alert.level;
      }
    }

    return summary;
  }

  /**
   * Internal: Compare alert levels
   */
  private isHigherLevel(level1: AlertLevel, level2: AlertLevel): boolean {
    const levelOrder: Record<AlertLevel, number> = {
      info: 1,
      warning: 2,
      critical: 3,
    };
    return levelOrder[level1] > levelOrder[level2];
  }

  /**
   * Internal: Add alert to history
   */
  private addToHistory(alert: Alert): void {
    this.alertHistory.push(alert);
    if (this.alertHistory.length > this.maxHistorySize) {
      this.alertHistory.shift();
    }
  }

  /**
   * Internal: Notify via channels
   */
  private async notifyChannels(alert: Alert, channels: string[]): Promise<void> {
    for (const channel of channels) {
      try {
        if (channel === 'log') {
          const level =
            alert.level === 'critical' ? 'error' :
            alert.level === 'warning' ? 'warn' :
            'log';
          this.logger[level](
            `[${alert.level.toUpperCase()}] Agent ${alert.agentId}: ${alert.message}`,
          );
          alert.channelsNotified.push('log');
        } else if (channel === 'websocket') {
          // Publish to Redis for OfficeGateway to broadcast
          await this.redis.publish(
            'hvo:office:events',
            JSON.stringify({
              type: 'alert:state',
              alert: {
                id: alert.id,
                agentId: alert.agentId,
                level: alert.level,
                message: alert.message,
                timestamp: new Date().toISOString(),
              },
            }),
          );
          alert.channelsNotified.push('websocket');
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to notify via ${channel}: ${errorMessage}`);
      }
    }
  }

  /**
   * Cleanup
   */
  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
    this.logger.log('AlertService cleanup complete');
  }
}
