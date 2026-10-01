import { Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { CloudEventService } from '../events/cloud-event.service';
import { AgentsService } from '../agents/agents.service';
import { AlertService, AlertLevel } from './alert.service';

/**
 * Alert Escalation Service (Phase 2 Sprint 3 Week 2)
 *
 * Monitors offline agents and escalates alerts through levels:
 * - Level 1 (Warning): Agent status = warning (log + WebSocket)
 * - Level 2 (Offline): Agent offline (Operator notification + UI highlight)
 * - Level 3 (Critical): Escalate to human (suggested action: restart/retry)
 *
 * Strategy:
 * - Track consecutive offline events per agent (threshold = 3)
 * - Maintain escalation state with cooldown (60s between alerts)
 * - Auto-escalate if offline persists
 * - De-escalate on recovery
 * - Publish CloudEvent on each escalation
 */
@Injectable()
export class AlertEscalationService {
  private readonly logger = new Logger(AlertEscalationService.name);
  private redis: Redis;

  // Escalation thresholds (consecutive offline count)
  private readonly thresholds = [3, 6, 10];
  private readonly cooldownMs = 60000; // 60 seconds between alerts

  // Track escalation state per agent
  private escalationState = new Map<
    string,
    {
      level: number; // 0=none, 1=warning, 2=offline, 3=critical
      offlineCount: number;
      lastAlertAt: Date | null;
      alertIds: string[];
    }
  >();

  constructor(
    private cloudEventService: CloudEventService,
    private agentsService: AgentsService,
    private alertService: AlertService,
  ) {
    this.redis = new (require('ioredis'))({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
    });

    this.redis.on('error', (err: Error) => {
      this.logger.error(`Redis connection error: ${err.message}`);
    });

    this.logger.log(
      `AlertEscalationService initialized: thresholds=${this.thresholds.join(',')}`,
    );
  }

  /**
   * Handle agent offline event
   * Increments offline count and escalates if threshold exceeded
   */
  async onAgentOffline(agentId: string): Promise<void> {
    try {
      let state = this.escalationState.get(agentId) || {
        level: 0,
        offlineCount: 0,
        lastAlertAt: null,
        alertIds: [],
      };

      state.offlineCount++;
      this.logger.warn(
        `Agent ${agentId} offline (count: ${state.offlineCount})`,
      );

      // Check escalation thresholds
      const newLevel = this.getAlertLevel(state.offlineCount);

      if (newLevel > state.level) {
        // Escalate to next level
        await this.escalate(agentId, state, newLevel);
      } else if (newLevel === state.level && this.canAlert(state)) {
        // Re-alert at same level if cooldown expired
        await this.reAlert(agentId, state);
      }

      this.escalationState.set(agentId, state);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to handle offline for agent ${agentId}: ${errorMessage}`,
      );
    }
  }

  /**
   * Handle agent online event
   * Resets offline count and de-escalates
   */
  async onAgentOnline(agentId: string): Promise<void> {
    try {
      const state = this.escalationState.get(agentId);
      if (!state || state.level === 0) {
        return;
      }

      this.logger.log(
        `Agent ${agentId} recovered from offline (was at level ${state.level})`,
      );

      // Resolve only the most recent alert (not duplicates)
      if (state.alertIds.length > 0) {
        const mostRecentAlertId = state.alertIds[state.alertIds.length - 1];
        try {
          await this.alertService.resolveAlert(mostRecentAlertId);
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Failed to resolve alert ${mostRecentAlertId}: ${errorMessage}`);
        }
      }

      // Reset escalation state
      state.level = 0;
      state.offlineCount = 0;
      state.lastAlertAt = null;
      state.alertIds = [];

      this.escalationState.set(agentId, state);

      // Publish recovery event
      await this.cloudEventService.publishAgentOnline(agentId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to handle online for agent ${agentId}: ${errorMessage}`,
      );
    }
  }

  /**
   * Escalate alert to next level
   */
  private async escalate(
    agentId: string,
    state: any,
    newLevel: number,
  ): Promise<void> {
    const levelNames = ['none', 'warning', 'offline', 'critical'];
    const oldLevelName = levelNames[state.level] || 'unknown';
    const newLevelName = levelNames[newLevel] || 'unknown';

    this.logger.warn(
      `Escalating agent ${agentId}: ${oldLevelName} → ${newLevelName}`,
    );

    // Check cooldown
    if (!this.canAlert(state)) {
      this.logger.debug(`Cooldown active for agent ${agentId}, skipping alert`);
      state.level = newLevel;
      return;
    }

    // Determine alert level for this escalation
    const alertLevel = this.getAlertLevelString(newLevel);
    const message = this.getEscalationMessage(agentId, newLevel);

    try {
      const alertId = await this.alertService.createAlert(
        agentId,
        alertLevel,
        message,
      );

      state.alertIds.push(alertId);
      state.level = newLevel;
      state.lastAlertAt = new Date();

      // Publish escalation event
      await this.cloudEventService.publishAlertEscalated(
        alertId,
        agentId,
        alertLevel,
        state.offlineCount,
      );

      // Broadcast to WebSocket (via Redis)
      await this.redis.publish(
        'hvo:office:events',
        JSON.stringify({
          type: 'escalation:level',
          agentId,
          level: newLevel,
          levelName: newLevelName,
          offlineCount: state.offlineCount,
          timestamp: new Date().toISOString(),
        }),
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to escalate alert for agent ${agentId}: ${errorMessage}`,
      );
    }
  }

  /**
   * Re-alert at current level if cooldown expired
   */
  private async reAlert(agentId: string, state: any): Promise<void> {
    const levelName = ['none', 'warning', 'offline', 'critical'][state.level];
    this.logger.debug(`Re-alerting for agent ${agentId} at level ${levelName}`);

    state.lastAlertAt = new Date();

    // Publish re-alert event
    await this.redis.publish(
      'hvo:office:events',
      JSON.stringify({
        type: 'escalation:reAlert',
        agentId,
        level: state.level,
        offlineCount: state.offlineCount,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  /**
   * Check if we can alert (cooldown expired)
   */
  private canAlert(state: any): boolean {
    if (!state.lastAlertAt) return true;

    const timeSinceLastAlert = Date.now() - state.lastAlertAt.getTime();
    return timeSinceLastAlert >= this.cooldownMs;
  }

  /**
   * Determine alert level (1, 2, or 3) based on offline count
   */
  getAlertLevel(offlineCount: number): number {
    if (offlineCount >= this.thresholds[2]) return 3; // critical
    if (offlineCount >= this.thresholds[1]) return 2; // offline
    if (offlineCount >= this.thresholds[0]) return 1; // warning
    return 0; // none
  }

  /**
   * Convert alert level to AlertLevel string
   */
  private getAlertLevelString(level: number): AlertLevel {
    if (level === 1) return 'info';
    if (level === 2) return 'warning';
    if (level === 3) return 'critical';
    return 'info';
  }

  /**
   * Get escalation message based on level
   */
  private getEscalationMessage(agentId: string, level: number): string {
    if (level === 1) {
      return `Agent ${agentId} offline - monitoring`;
    }
    if (level === 2) {
      return `Agent ${agentId} offline - operator notification required`;
    }
    if (level === 3) {
      return `Agent ${agentId} critical failure - immediate escalation to human required`;
    }
    return `Agent ${agentId} status changed`;
  }

  /**
   * Get escalation state for agent
   */
  getEscalationState(agentId: string): any {
    return this.escalationState.get(agentId) || {
      level: 0,
      offlineCount: 0,
      lastAlertAt: null,
      alertIds: [],
    };
  }

  /**
   * Get all escalation states
   */
  getAllEscalationStates(): Record<string, any> {
    const states: Record<string, any> = {};
    for (const [agentId, state] of this.escalationState.entries()) {
      states[agentId] = state;
    }
    return states;
  }

  /**
   * Get summary
   */
  getSummary(): {
    activeEscalations: number;
    byLevel: Record<number, number>;
  } {
    const summary = {
      activeEscalations: 0,
      byLevel: { 1: 0, 2: 0, 3: 0 } as Record<number, number>,
    };

    for (const state of this.escalationState.values()) {
      if (state.level > 0) {
        summary.activeEscalations++;
        summary.byLevel[state.level]++;
      }
    }

    return summary;
  }

  /**
   * Cleanup
   */
  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
    this.logger.log('AlertEscalationService cleanup complete');
  }
}
