import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { HermesAdapterInterface } from './hermes-adapter.interface';

/**
 * Mock Hermes Adapter (Phase 0-1)
 * In-memory implementation for testing without real Hermes runtime
 * Tracks task state and agent assignments
 * Real implementation will replace this in Phase 2+
 */
@Injectable()
export class MockHermesAdapter implements HermesAdapterInterface {
  private readonly logger = new Logger(MockHermesAdapter.name);

  // In-memory stores
  private taskStates = new Map<
    string,
    {
      status: string;
      progress: number;
      lastUpdate: Date;
    }
  >();
  private agentStates = new Map<
    string,
    {
      agentId: string;
      status: string;
      currentTask?: string;
      capabilities: string[];
    }
  >();

  /**
   * Dispatch a task to Hermes (mock: creates in-memory tracking)
   * Generates hermes_task_id = hvo:{taskId}-{timestamp}
   */
  async dispatchTask(
    taskId: string,
    taskTitle: string,
    agentId: string,
    metadata?: Record<string, any>,
  ): Promise<string> {
    const hermesTaskId = `hvo:${taskId}-${Date.now()}`;

    this.taskStates.set(hermesTaskId, {
      status: 'assigned',
      progress: 0,
      lastUpdate: new Date(),
    });

    // Update agent state
    const agentState = this.agentStates.get(agentId) || {
      agentId,
      status: 'idle',
      capabilities: [],
    };
    agentState.currentTask = hermesTaskId;
    agentState.status = 'working';
    this.agentStates.set(agentId, agentState);

    this.logger.log(
      `Task dispatched to Hermes: ${hermesTaskId} (agent: ${agentId}, title: ${taskTitle})`,
    );

    return hermesTaskId;
  }

  /**
   * Get task status from in-memory store
   */
  async getTaskStatus(
    hermesTaskId: string,
  ): Promise<{
    status: string;
    progress: number;
    lastUpdate: Date;
  }> {
    const state = this.taskStates.get(hermesTaskId);

    if (!state) {
      // Default state for unknown tasks
      return {
        status: 'unknown',
        progress: 0,
        lastUpdate: new Date(),
      };
    }

    return state;
  }

  /**
   * Get agent status from in-memory store
   */
  async getAgentStatus(
    agentId: string,
  ): Promise<{
    agentId: string;
    status: string;
    currentTask?: string;
    capabilities: string[];
  }> {
    return (
      this.agentStates.get(agentId) || {
        agentId,
        status: 'idle',
        capabilities: [],
      }
    );
  }

  /**
   * Send signal to agent (pause/resume/cancel)
   */
  async sendSignal(
    agentId: string,
    signal: 'pause' | 'resume' | 'cancel',
  ): Promise<void> {
    const agentState = this.agentStates.get(agentId);

    if (!agentState) {
      this.logger.warn(`Agent ${agentId} not found in mock state`);
      return;
    }

    if (signal === 'pause') {
      agentState.status = 'paused';
    } else if (signal === 'resume') {
      agentState.status = 'working';
    } else if (signal === 'cancel') {
      agentState.status = 'idle';
      agentState.currentTask = undefined;
    }

    this.agentStates.set(agentId, agentState);
    this.logger.log(`Signal sent to agent ${agentId}: ${signal}`);
  }

  /**
   * Get list of idle agents available for assignment
   */
  async getIdleAgents(): Promise<string[]> {
    const idleAgents = Array.from(this.agentStates.values())
      .filter((state) => state.status === 'idle')
      .map((state) => state.agentId);

    return idleAgents;
  }

  /**
   * Simulate task progress (for testing)
   */
  simulateTaskProgress(hermesTaskId: string, progress: number): void {
    const state = this.taskStates.get(hermesTaskId);
    if (state) {
      state.progress = Math.min(progress, 100);
      state.lastUpdate = new Date();
    }
  }

  /**
   * Simulate task completion (for testing)
   */
  simulateTaskCompletion(hermesTaskId: string): void {
    const state = this.taskStates.get(hermesTaskId);
    if (state) {
      state.status = 'completed';
      state.progress = 100;
      state.lastUpdate = new Date();
    }
  }

  /**
   * Get all in-memory task states (for testing/debugging)
   */
  getTaskStates(): Map<
    string,
    {
      status: string;
      progress: number;
      lastUpdate: Date;
    }
  > {
    return this.taskStates;
  }

  /**
   * Get all in-memory agent states (for testing/debugging)
   */
  getAgentStates(): Map<
    string,
    {
      agentId: string;
      status: string;
      currentTask?: string;
      capabilities: string[];
    }
  > {
    return this.agentStates;
  }
}
