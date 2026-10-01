import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { CloudEventService } from '../events/cloud-event.service';
import { AgentsService } from '../agents/agents.service';
import { AlertService, AlertLevel } from './alert.service';

/**
 * Escalation state per agent
 */
interface EscalationState {
  level: AlertLevel;
  alertId?: string;
  escalatedAt: Date;
}

/**
 * Heartbeat Monitoring Service (Phase 2 Week 2)
 * Enhanced with periodic checks and alert escalation
 *
 * Strategy:
 * - Subscribe to Hermes heartbeat stream (via Redis pub/sub or polling)
 * - Track lastHeartbeat per agent + escalation state
 * - Run periodic check every 5s
 * - Detect offline: no heartbeat for 15s
 * - Escalate: info → warning (10s) → critical (30s)
 * - Auto-recover when heartbeat resumes
 * - Emit CloudEvent on escalation level change
 */
@Injectable()
export class HeartbeatMonitoringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HeartbeatMonitoringService.name);
  private redis: Redis;
  private subscriber: Redis;

  // Configuration
  private heartbeatTimeoutMs: number = 15000; // 15 seconds
  private graceTimeMs: number = 5000; // 5 second grace period
  private checkIntervalMs: number = 5000; // Check every 5 seconds
  private warningThresholdMs: number = 10000; // Escalate to warning after 10s
  private criticalThresholdMs: number = 30000; // Escalate to critical after 30s

  // Track agent heartbeats: agentId → { lastHeartbeat: Date, status, escalation }
  private agentHeartbeats = new Map<
    string,
    {
      lastHeartbeat: Date;
      status: 'online' | 'offline' | 'warning';
      consecutiveOfflineCount: number;
      escalationState?: EscalationState;
    }
  >();

  // Periodic check interval handle
  private periodicCheckInterval: NodeJS.Timeout | null = null;

  constructor(
    private cloudEventService: CloudEventService,
    private agentsService: AgentsService,
    private alertService: AlertService,
  ) {
    // Initialize Redis clients
    this.redis = new (require('ioredis'))(
      {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD,
        retryStrategy: (times: number) => Math.min(times * 50, 2000),
      },
    );

    this.subscriber = new (require('ioredis'))(
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

    this.subscriber.on('error', (err: Error) => {
      this.logger.error(`Redis subscriber connection error: ${err.message}`);
    });

    // Parse configuration
    this.heartbeatTimeoutMs = parseInt(
      process.env.HEARTBEAT_TIMEOUT_MS || '15000',
      10,
    );
    this.graceTimeMs = parseInt(
      process.env.HEARTBEAT_GRACE_MS || '5000',
      10,
    );
    this.checkIntervalMs = parseInt(
      process.env.HEARTBEAT_CHECK_INTERVAL_MS || '5000',
      10,
    );
    this.warningThresholdMs = parseInt(
      process.env.HEARTBEAT_WARNING_THRESHOLD_MS || '10000',
      10,
    );
    this.criticalThresholdMs = parseInt(
      process.env.HEARTBEAT_CRITICAL_THRESHOLD_MS || '30000',
      10,
    );

    this.logger.log(
      `HeartbeatMonitoringService initialized: timeout=${this.heartbeatTimeoutMs}ms, ` +
      `grace=${this.graceTimeMs}ms, check=${this.checkIntervalMs}ms, ` +
      `warning=${this.warningThresholdMs}ms, critical=${this.criticalThresholdMs}ms`,
    );
  }

  /**
   * Initialize heartbeat monitoring and start periodic checks
   */
  async onModuleInit(): Promise<void> {
    try {
      this.logger.log('Subscribing to heartbeat events...');

      // Subscribe to Hermes heartbeat channel
      this.subscriber.on('subscribe', (channel: string) => {
        if (channel === 'hermes:heartbeat') {
          this.logger.log('Subscribed to hermes:heartbeat');
        }
      });

      this.subscriber.on('error', (err: Error) => {
        this.logger.error(`Subscription error: ${err.message}`);
      });

      await this.subscriber.subscribe('hermes:heartbeat');

      // Listen for heartbeat messages
      this.subscriber.on('message', (channel: string, message: string) => {
        if (channel === 'hermes:heartbeat') {
          this.handleHeartbeatMessage(message);
        }
      });

      // Initialize heartbeats for all agents
      const agents = await this.agentsService.listAgents();
      for (const agent of agents) {
        this.agentHeartbeats.set(agent.id, {
          lastHeartbeat: new Date(),
          status: 'online',
          consecutiveOfflineCount: 0,
        });
      }

      this.logger.log(`Initialized heartbeats for ${agents.length} agents`);

      // Start periodic heartbeat check (every 5 seconds)
      this.startPeriodicCheck();

      this.logger.log('Heartbeat monitoring service started with periodic checks');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to initialize heartbeat monitoring: ${errorMessage}`,
      );
    }
  }

  /**
   * Cleanup on module destroy
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log('Cleaning up heartbeat monitoring...');
    
    // Stop periodic check
    if (this.periodicCheckInterval) {
      clearInterval(this.periodicCheckInterval);
      this.periodicCheckInterval = null;
    }

    await this.subscriber.unsubscribe();
    await this.redis.quit();
    await this.subscriber.quit();
    this.logger.log('Heartbeat monitoring cleanup complete');
  }

  /**
   * Start periodic check (every 5 seconds)
   * Runs checkHeartbeats() to detect offline agents and manage escalation
   */
  private startPeriodicCheck(): void {
    if (this.periodicCheckInterval) {
      return; // Already running
    }

    this.periodicCheckInterval = setInterval(async () => {
      try {
        await this.checkHeartbeats();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Error during periodic check: ${errorMessage}`);
      }
    }, this.checkIntervalMs);

    this.logger.log(`Started periodic check every ${this.checkIntervalMs}ms`);
  }

  /**
   * Handle heartbeat message from Redis pub/sub
   * Format: { agentId, timestamp, status?, capabilities? }
   */
  private handleHeartbeatMessage(message: string): void {
    try {
      const heartbeat = JSON.parse(message);
      const { agentId, timestamp, status } = heartbeat;

      if (!agentId) {
        this.logger.warn('Heartbeat message missing agentId');
        return;
      }

      // Update or create heartbeat entry
      const existing = this.agentHeartbeats.get(agentId) || {
        lastHeartbeat: new Date(),
        status: 'online',
        consecutiveOfflineCount: 0,
      };

      const wasOffline = existing.status === 'offline' || existing.status === 'warning';

      existing.lastHeartbeat = new Date(timestamp || Date.now());
      existing.status = 'online';
      existing.consecutiveOfflineCount = 0;

      // Clear escalation on recovery
      if (wasOffline && existing.escalationState) {
        this.resolveEscalation(agentId, existing.escalationState.alertId);
        existing.escalationState = undefined;
      }

      this.agentHeartbeats.set(agentId, existing);

      this.logger.debug(
        `Heartbeat received: ${agentId} at ${existing.lastHeartbeat.toISOString()}`,
      );

      // Emit online event if agent was offline/warning
      if (wasOffline) {
        this.emit('agent:online', agentId, existing.lastHeartbeat);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to parse heartbeat message: ${errorMessage}`);
    }
  }

  /**
   * Periodic check for offline agents
   * Runs every 5 seconds
   * Manages escalation: online → warning → critical
   */
  async checkHeartbeats(): Promise<void> {
    const now = new Date();

    for (const [agentId, heartbeat] of this.agentHeartbeats.entries()) {
      const timeSinceLastHeartbeat = now.getTime() - heartbeat.lastHeartbeat.getTime();

      if (timeSinceLastHeartbeat > this.heartbeatTimeoutMs) {
        // OFFLINE: No heartbeat for > 15 seconds
        if (heartbeat.status !== 'offline') {
          heartbeat.status = 'offline';
          heartbeat.consecutiveOfflineCount++;
          this.agentHeartbeats.set(agentId, heartbeat);

          this.logger.warn(
            `Agent ${agentId} detected OFFLINE (${timeSinceLastHeartbeat}ms without heartbeat)`,
          );

          // Emit offline event
          this.emit('agent:offline', agentId, heartbeat.lastHeartbeat);

          // Update agent status in database
          this.updateAgentStatus(agentId, 'offline');

          // Initiate escalation if not already escalated
          if (!heartbeat.escalationState) {
            await this.initiateEscalation(agentId);
          }
        }

        // Check for escalation progression
        if (heartbeat.escalationState) {
          await this.checkEscalation(agentId, timeSinceLastHeartbeat);
        }
      } else if (timeSinceLastHeartbeat > this.warningThresholdMs) {
        // WARNING: Online → Warning (10-15 seconds)
        if (heartbeat.status === 'online') {
          heartbeat.status = 'warning';
          this.agentHeartbeats.set(agentId, heartbeat);

          this.logger.warn(
            `Agent ${agentId} entering WARNING state (${timeSinceLastHeartbeat}ms since heartbeat)`,
          );

          // Emit warning event
          this.emit('agent:warning', agentId, heartbeat.lastHeartbeat);
        }
      } else {
        // ONLINE: Recovery from offline/warning
        if (heartbeat.status !== 'online') {
          heartbeat.status = 'online';
          heartbeat.consecutiveOfflineCount = 0;
          this.agentHeartbeats.set(agentId, heartbeat);

          this.logger.log(`Agent ${agentId} recovered to ONLINE`);

          // Emit online event
          this.emit('agent:online', agentId, heartbeat.lastHeartbeat);

          // Update agent status in database
          this.updateAgentStatus(agentId, 'idle');

          // Auto-resolve alerts
          if (heartbeat.escalationState) {
            await this.resolveEscalation(agentId, heartbeat.escalationState.alertId);
            heartbeat.escalationState = undefined;
            this.agentHeartbeats.set(agentId, heartbeat);
          }
        }
      }
    }
  }

  /**
   * Initiate escalation for offline agent
   * Creates initial 'info' level alert
   */
  private async initiateEscalation(agentId: string): Promise<void> {
    try {
      const alertId = await this.alertService.createAlert(
        agentId,
        'info',
        `Agent ${agentId} offline - monitoring escalation`,
      );

      const heartbeat = this.agentHeartbeats.get(agentId);
      if (heartbeat) {
        heartbeat.escalationState = {
          level: 'info',
          alertId,
          escalatedAt: new Date(),
        };
        this.agentHeartbeats.set(agentId, heartbeat);
      }

      this.logger.log(`Escalation initiated for agent ${agentId}: alert ${alertId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to initiate escalation: ${errorMessage}`);
    }
  }

  /**
   * Check and escalate alert level based on offline duration
   */
  private async checkEscalation(
    agentId: string,
    timeSinceLastHeartbeat: number,
  ): Promise<void> {
    const heartbeat = this.agentHeartbeats.get(agentId);
    if (!heartbeat || !heartbeat.escalationState) {
      return;
    }

    const escalationState = heartbeat.escalationState;
    const timeInEscalation = Date.now() - escalationState.escalatedAt.getTime();

    // Escalate: info → warning (after 10s offline)
    if (
      escalationState.level === 'info' &&
      timeSinceLastHeartbeat >= this.warningThresholdMs
    ) {
      try {
        if (escalationState.alertId) {
          await this.alertService.escalateAlert(escalationState.alertId);
          escalationState.level = 'warning';
          this.logger.warn(`Alert escalated for agent ${agentId}: info → warning`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to escalate alert: ${errorMessage}`);
      }
    }

    // Escalate: warning → critical (after 30s offline)
    if (
      escalationState.level === 'warning' &&
      timeSinceLastHeartbeat >= this.criticalThresholdMs
    ) {
      try {
        if (escalationState.alertId) {
          await this.alertService.escalateAlert(escalationState.alertId);
          escalationState.level = 'critical';
          this.logger.error(
            `Alert escalated for agent ${agentId}: warning → critical (${timeSinceLastHeartbeat}ms offline)`,
          );
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to escalate alert: ${errorMessage}`);
      }
    }
  }

  /**
   * Resolve escalation when agent recovers
   */
  private async resolveEscalation(
    agentId: string,
    alertId?: string,
  ): Promise<void> {
    try {
      if (alertId) {
        await this.alertService.resolveAlert(alertId);
        this.logger.log(
          `Alert resolved for agent ${agentId}: ${alertId}`,
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to resolve alert: ${errorMessage}`);
    }
  }

  /**
   * Record heartbeat from agent
   * Called by HermesAdapter when receiving heartbeat events
   */
  recordHeartbeat(agentId: string, timestamp?: Date): void {
    const now = timestamp || new Date();

    const existing = this.agentHeartbeats.get(agentId) || {
      lastHeartbeat: now,
      status: 'online',
      consecutiveOfflineCount: 0,
    };

    existing.lastHeartbeat = now;
    if (existing.status !== 'online') {
      existing.status = 'online';
      existing.consecutiveOfflineCount = 0;

      // Auto-resolve escalation
      if (existing.escalationState) {
        this.resolveEscalation(agentId, existing.escalationState.alertId);
        existing.escalationState = undefined;
      }

      this.emit('agent:online', agentId, now);
    }

    this.agentHeartbeats.set(agentId, existing);
  }

  /**
   * Publish heartbeat to Redis for other services
   * Called by agents to advertise their status
   */
  async publishHeartbeat(
    agentId: string,
    status: string,
    capabilities?: string[],
  ): Promise<void> {
    try {
      const heartbeatEvent = {
        agentId,
        status,
        capabilities: capabilities || [],
        timestamp: new Date().toISOString(),
      };

      await this.redis.publish('hermes:heartbeat', JSON.stringify(heartbeatEvent));
      this.logger.debug(`Published heartbeat for ${agentId}: ${status}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to publish heartbeat: ${errorMessage}`);
    }
  }

  /**
   * Internal: Update agent status in database
   */
  private async updateAgentStatus(
    agentId: string,
    status: 'online' | 'offline' | 'idle',
  ): Promise<void> {
    try {
      await this.agentsService.updateAgentStatus(agentId, status);
      this.logger.log(`Updated agent ${agentId} status to ${status}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to update agent status: ${errorMessage}`);
    }
  }

  /**
   * Internal: Emit heartbeat event to all subscribers
   */
  private emit(eventName: string, agentId: string, timestamp: Date): void {
    // Emit to CloudEvent system
    if (eventName === 'agent:online') {
      this.cloudEventService.publishAgentOnline(agentId).catch((err) => {
        this.logger.warn(`Failed to publish agent:online event: ${err.message}`);
      });
    } else if (eventName === 'agent:offline') {
      this.cloudEventService.publishAgentOffline(agentId).catch((err) => {
        this.logger.warn(`Failed to publish agent:offline event: ${err.message}`);
      });
    }

    // Broadcast via WebSocket (via OfficeGateway)
    this.redis.publish(
      'hvo:office:events',
      JSON.stringify({
        type: `heartbeat:${eventName}`,
        agentId,
        timestamp: timestamp.toISOString(),
      }),
    ).catch((err) => {
      this.logger.warn(`Failed to broadcast heartbeat event: ${err.message}`);
    });
  }

  /**
   * Get all agent heartbeats (for debugging)
   */
  getAllHeartbeats(): Map<
    string,
    {
      lastHeartbeat: Date;
      status: 'online' | 'offline' | 'warning';
      consecutiveOfflineCount: number;
      escalationState?: EscalationState;
    }
  > {
    return this.agentHeartbeats;
  }

  /**
   * Get heartbeat for specific agent
   */
  getAgentHeartbeat(
    agentId: string,
  ): {
    lastHeartbeat: Date;
    status: 'online' | 'offline' | 'warning';
    consecutiveOfflineCount: number;
    escalationState?: EscalationState;
  } | null {
    return this.agentHeartbeats.get(agentId) || null;
  }

  /**
   * Get agent status summary
   */
  getStatusSummary(): {
    online: number;
    offline: number;
    warning: number;
    agents: Record<string, any>;
  } {
    let online = 0;
    let offline = 0;
    let warning = 0;
    const agents: Record<string, any> = {};

    for (const [agentId, heartbeat] of this.agentHeartbeats.entries()) {
      if (heartbeat.status === 'online') online++;
      if (heartbeat.status === 'offline') offline++;
      if (heartbeat.status === 'warning') warning++;

      agents[agentId] = {
        status: heartbeat.status,
        lastHeartbeat: heartbeat.lastHeartbeat.toISOString(),
        consecutiveOfflineCount: heartbeat.consecutiveOfflineCount,
        escalationLevel: heartbeat.escalationState?.level || null,
      };
    }

    return { online, offline, warning, agents };
  }

  /**
   * Get periodic check status
   */
  isPeriodicCheckRunning(): boolean {
    return this.periodicCheckInterval !== null;
  }
}
