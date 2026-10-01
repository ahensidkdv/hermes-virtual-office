import { Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { CloudEventService } from '../events/cloud-event.service';
import { AgentsService } from '../agents/agents.service';

/**
 * Periodic Heartbeat Check Service (Phase 2 Sprint 3 Week 2)
 *
 * Polls Hermes every 5 seconds to verify agent health.
 * Compares expected status vs. actual status from Hermes.
 *
 * Strategy:
 * - Run polling loop: every 5 seconds
 * - Query Hermes adapter for each agent's actual status
 * - Compare against database/local state (detect divergence)
 * - Publish events:
 *   - heartbeat.check: normal poll result
 *   - heartbeat.mismatch: divergence detected
 * - Handle errors gracefully (log + continue)
 * - Testable start/stop without @nestjs/schedule
 */
@Injectable()
export class PeriodicHeartbeatCheckService {
  private readonly logger = new Logger(PeriodicHeartbeatCheckService.name);
  private redis: Redis;

  // Configuration
  private checkIntervalMs: number = 5000; // Poll every 5 seconds
  private maxErrorRetries: number = 3;

  // Polling state
  private pollingInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  // Track last check per agent
  private lastCheckTimestamp = new Map<string, Date>();
  private consecutiveErrors = new Map<string, number>();

  constructor(
    private cloudEventService: CloudEventService,
    private agentsService: AgentsService,
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

    // Parse configuration
    this.checkIntervalMs = parseInt(
      process.env.HEARTBEAT_CHECK_INTERVAL_MS || '5000',
      10,
    );

    this.logger.log(
      `PeriodicHeartbeatCheckService initialized: checkInterval=${this.checkIntervalMs}ms`,
    );
  }

  /**
   * Start the periodic heartbeat check loop
   * Must be called explicitly (not via @nestjs/schedule)
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Periodic check already running');
      return;
    }

    this.isRunning = true;
    this.logger.log(
      `Starting periodic heartbeat checks every ${this.checkIntervalMs}ms`,
    );

    // Run first check immediately, then schedule
    await this.performCheck();

    this.pollingInterval = setInterval(async () => {
      try {
        await this.performCheck();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Error during periodic check: ${errorMessage}`);
      }
    }, this.checkIntervalMs);
  }

  /**
   * Stop the periodic heartbeat check loop
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    this.logger.log('Periodic heartbeat checks stopped');
  }

  /**
   * Perform one cycle of heartbeat checks for all agents
   * Called every 5 seconds
   */
  private async performCheck(): Promise<void> {
    try {
      const agents = await this.agentsService.listAgents();

      for (const agent of agents) {
        await this.checkAgentHeartbeat(agent.id);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get agents list: ${errorMessage}`);
    }
  }

  /**
   * Check heartbeat for a single agent
   * Compares expected vs. actual status
   */
  private async checkAgentHeartbeat(agentId: string): Promise<void> {
    try {
      const now = new Date();

      // Query Hermes for actual agent status (via adapter)
      // TODO: integrate with RealHermesAdapter
      const hermesStatus = await this.queryHermesStatus(agentId);

      // Get expected status from database
      const dbAgent = await this.agentsService.getAgent(agentId);
      const expectedStatus = dbAgent?.status || 'offline';

      // Track last check
      this.lastCheckTimestamp.set(agentId, now);
      this.consecutiveErrors.delete(agentId); // Clear error counter on success

      // Compare: detect divergence
      if (hermesStatus !== expectedStatus) {
        this.logger.warn(
          `Heartbeat mismatch for agent ${agentId}: expected=${expectedStatus}, actual=${hermesStatus}`,
        );

        // Publish mismatch event
        await this.publishHeartbeatMismatch(agentId, expectedStatus, hermesStatus);
      } else {
        // Normal check - publish event
        await this.publishHeartbeatCheck(agentId, hermesStatus);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.handleCheckError(agentId, errorMessage);
    }
  }

  /**
   * Query Hermes for agent status
   * Placeholder: integrate with RealHermesAdapter
   */
  private async queryHermesStatus(agentId: string): Promise<string> {
    // TODO: Call RealHermesAdapter.getAgentStatus(agentId)
    // For now, return placeholder
    return 'online';
  }

  /**
   * Publish heartbeat.check event (normal poll)
   */
  private async publishHeartbeatCheck(
    agentId: string,
    status: string,
  ): Promise<void> {
    try {
      const event = {
        type: 'heartbeat.check',
        agentId,
        status,
        timestamp: new Date().toISOString(),
      };

      await this.redis.publish('hermes:events', JSON.stringify(event));
      this.logger.debug(`Published heartbeat.check: ${agentId} = ${status}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to publish heartbeat.check: ${errorMessage}`);
    }
  }

  /**
   * Publish heartbeat.mismatch event (divergence detected)
   */
  private async publishHeartbeatMismatch(
    agentId: string,
    expectedStatus: string,
    actualStatus: string,
  ): Promise<void> {
    try {
      const event = {
        type: 'heartbeat.mismatch',
        agentId,
        expectedStatus,
        actualStatus,
        timestamp: new Date().toISOString(),
      };

      await this.redis.publish('hermes:events', JSON.stringify(event));
      await this.cloudEventService.publishAgentOffline(agentId); // Escalate to CloudEvent

      this.logger.warn(`Published heartbeat.mismatch: ${agentId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to publish heartbeat.mismatch: ${errorMessage}`);
    }
  }

  /**
   * Handle check errors gracefully
   */
  private handleCheckError(agentId: string, errorMessage: string): void {
    const errorCount = (this.consecutiveErrors.get(agentId) || 0) + 1;
    this.consecutiveErrors.set(agentId, errorCount);

    if (errorCount <= this.maxErrorRetries) {
      this.logger.warn(
        `Check error for agent ${agentId} (${errorCount}/${this.maxErrorRetries}): ${errorMessage}`,
      );
    } else {
      this.logger.error(
        `Check failed for agent ${agentId} after ${this.maxErrorRetries} retries: ${errorMessage}`,
      );
      // Publish error event
      this.redis.publish(
        'hermes:events',
        JSON.stringify({
          type: 'heartbeat.check.error',
          agentId,
          errorCount,
          timestamp: new Date().toISOString(),
        }),
      ).catch(() => {
        // Silently ignore publish errors
      });
    }
  }

  /**
   * Get polling status
   */
  getStatus(): {
    isRunning: boolean;
    checkIntervalMs: number;
    lastCheckTimestamps: Record<string, string>;
  } {
    const lastCheckTimestamps: Record<string, string> = {};
    for (const [agentId, timestamp] of this.lastCheckTimestamp.entries()) {
      lastCheckTimestamps[agentId] = timestamp.toISOString();
    }

    return {
      isRunning: this.isRunning,
      checkIntervalMs: this.checkIntervalMs,
      lastCheckTimestamps,
    };
  }

  /**
   * Get last check timestamp for agent
   */
  getLastCheckTime(agentId: string): Date | null {
    return this.lastCheckTimestamp.get(agentId) || null;
  }

  /**
   * Cleanup
   */
  async onModuleDestroy(): Promise<void> {
    await this.stop();
    await this.redis.quit();
    this.logger.log('PeriodicHeartbeatCheckService cleanup complete');
  }
}
