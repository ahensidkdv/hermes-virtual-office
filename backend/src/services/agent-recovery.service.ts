import { Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { CloudEventService } from '../events/cloud-event.service';
import { AgentsService } from '../agents/agents.service';

/**
 * Agent Recovery Service (Phase 2 Sprint 3 Week 2)
 *
 * Implements auto-recovery workflow for offline agents:
 * - Attempt reconnect when offline detected
 * - Send recovery command to Hermes (if available)
 * - Update agent status on recovery
 * - Publish recovery event (agent.recovered)
 *
 * Strategy:
 * - Retry logic: exponential backoff (max 3 attempts)
 * - Wait before first retry (random jitter to avoid thundering herd)
 * - Track recovery attempts per agent
 * - On success: update status → publish event
 * - On failure: log + allow escalation service to handle
 */
@Injectable()
export class AgentRecoveryService {
  private readonly logger = new Logger(AgentRecoveryService.name);
  private redis: Redis;

  // Configuration
  private readonly maxRetries = 3;
  private readonly initialDelayMs = 1000; // Start at 1 second
  private readonly maxDelayMs = 30000; // Cap at 30 seconds
  private readonly jitterMs = 500; // Random jitter

  // Track recovery attempts
  private recoveryAttempts = new Map<string, { count: number; lastAttemptAt: Date }>();

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

    this.logger.log(
      `AgentRecoveryService initialized: maxRetries=${this.maxRetries}`,
    );
  }

  /**
   * Attempt to recover offline agent
   * Implements exponential backoff retry logic
   */
  async attemptRecovery(agentId: string): Promise<boolean> {
    try {
      const attempt = this.recoveryAttempts.get(agentId) || { count: 0, lastAttemptAt: new Date() };

      if (attempt.count >= this.maxRetries) {
        this.logger.warn(
          `Agent ${agentId} recovery exhausted (${this.maxRetries} attempts)`,
        );
        return false;
      }

      // Calculate backoff delay
      const delay = this.calculateBackoffDelay(attempt.count);
      await this.sleep(delay);

      this.logger.log(
        `Attempting recovery for agent ${agentId} (attempt ${attempt.count + 1}/${this.maxRetries})`,
      );

      // Try to reconnect
      const success = await this.reconnectAgent(agentId);

      if (success) {
        this.logger.log(`Agent ${agentId} recovered successfully`);

        // Reset attempts on success
        this.recoveryAttempts.delete(agentId);

        // Update status and publish event
        await this.onRecovery(agentId);

        return true;
      } else {
        // Increment attempt counter
        attempt.count++;
        attempt.lastAttemptAt = new Date();
        this.recoveryAttempts.set(agentId, attempt);

        this.logger.warn(
          `Recovery attempt ${attempt.count} failed for agent ${agentId}`,
        );

        return false;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Recovery failed for agent ${agentId}: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Reconnect agent via Hermes command
   * Placeholder: integrate with RealHermesAdapter
   */
  private async reconnectAgent(agentId: string): Promise<boolean> {
    try {
      // TODO: Send command to Hermes to reconnect agent
      // const hermesAdapter = inject(RealHermesAdapter);
      // return await hermesAdapter.reconnectAgent(agentId);

      // Placeholder: simulate reconnection
      this.logger.debug(`Sending reconnect command to Hermes for ${agentId}`);

      // For now, return true to test flow
      return Math.random() > 0.3; // 70% success rate for testing
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Hermes reconnect failed: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Handle agent recovery
   * Update status and publish event
   */
  private async onRecovery(agentId: string): Promise<void> {
    try {
      // Update agent status to online
      await this.agentsService.updateAgentStatus(agentId, 'online');

      // Publish recovery event
      await this.cloudEventService.publishAgentOnline(agentId);

      // Broadcast via WebSocket
      await this.redis.publish(
        'hvo:office:events',
        JSON.stringify({
          type: 'agent:recovered',
          agentId,
          timestamp: new Date().toISOString(),
        }),
      );

      this.logger.log(`Agent ${agentId} recovery published`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to publish recovery for agent ${agentId}: ${errorMessage}`);
    }
  }

  /**
   * Calculate exponential backoff delay with jitter
   */
  private calculateBackoffDelay(attemptNumber: number): number {
    const exponentialDelay = this.initialDelayMs * Math.pow(2, attemptNumber);
    const cappedDelay = Math.min(exponentialDelay, this.maxDelayMs);
    const jitter = Math.random() * this.jitterMs;
    return cappedDelay + jitter;
  }

  /**
   * Helper: sleep for ms milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get recovery status for agent
   */
  getRecoveryStatus(agentId: string): { attempts: number; lastAttemptAt: Date | null } {
    const state = this.recoveryAttempts.get(agentId);
    return {
      attempts: state?.count || 0,
      lastAttemptAt: state?.lastAttemptAt || null,
    };
  }

  /**
   * Get all recovery statuses
   */
  getAllRecoveryStatuses(): Record<string, { attempts: number; lastAttemptAt: Date | null }> {
    const statuses: Record<string, any> = {};
    for (const [agentId, state] of this.recoveryAttempts.entries()) {
      statuses[agentId] = {
        attempts: state.count,
        lastAttemptAt: state.lastAttemptAt,
      };
    }
    return statuses;
  }

  /**
   * Reset recovery state for agent (manual reset)
   */
  resetRecoveryState(agentId: string): void {
    this.recoveryAttempts.delete(agentId);
    this.logger.log(`Reset recovery state for agent ${agentId}`);
  }

  /**
   * Cleanup
   */
  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
    this.logger.log('AgentRecoveryService cleanup complete');
  }
}
