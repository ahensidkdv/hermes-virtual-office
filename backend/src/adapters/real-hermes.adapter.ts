import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { HermesAdapterInterface } from './hermes-adapter.interface';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

/**
 * Real Hermes Adapter (Phase 2+)
 * Dispatches tasks to actual Hermes runtime via subprocess
 * Subscribes to Hermes events via stdout/stderr and parses CloudEvents
 * Handles error recovery with exponential backoff retry logic
 */
@Injectable()
export class RealHermesAdapter extends EventEmitter implements HermesAdapterInterface {
  private readonly logger = new Logger(RealHermesAdapter.name);

  // Cache: hermes_task_id → { status, progress, lastUpdate, agentId }
  private taskStates = new Map<
    string,
    {
      status: string;
      progress: number;
      lastUpdate: Date;
      agentId?: string;
    }
  >();

  // Cache: agentId → { agentId, status, currentTask, capabilities, lastHeartbeat }
  private agentStates = new Map<
    string,
    {
      agentId: string;
      status: string;
      currentTask?: string;
      capabilities: string[];
      lastHeartbeat: Date;
    }
  >();

  // Configuration
  private hermesCliPath: string;
  private hermesTimeout: number = 3600000; // 1 hour default
  private retryAttempts: number = 3;
  private retryBackoffMs: number = 1000;
  private taskProcesses = new Map<string, any>();

  constructor() {
    super();
    this.hermesCliPath = process.env.HERMES_CLI_PATH || 'hermes';
    this.hermesTimeout = parseInt(process.env.HERMES_TIMEOUT || '3600000', 10);
    this.retryAttempts = parseInt(process.env.HERMES_RETRY_ATTEMPTS || '3', 10);
    this.retryBackoffMs = parseInt(process.env.HERMES_RETRY_BACKOFF_MS || '1000', 10);
    this.logger.log(
      `RealHermesAdapter initialized: CLI=${this.hermesCliPath}, timeout=${this.hermesTimeout}ms, retries=${this.retryAttempts}`,
    );
  }

  /**
   * Dispatch a task to Hermes runtime
   * Spawns a subprocess: hermes chat -q "<task description>"
   * Returns hermes_task_id and tracks status via event subscription
   */
  async dispatchTask(
    taskId: string,
    taskTitle: string,
    agentId: string,
    metadata?: Record<string, any>,
  ): Promise<string> {
    const hermesTaskId = `hvo:${taskId}-${Date.now()}`;
    let attempt = 0;

    while (attempt < this.retryAttempts) {
      try {
        this.logger.log(
          `[Attempt ${attempt + 1}/${this.retryAttempts}] Dispatching task to Hermes: ${hermesTaskId}`,
        );

        // Prepare task command
        const taskDescription = `${taskTitle}${metadata?.description ? '\n' + metadata.description : ''}`;
        const hermesCommand = this.buildHermesCommand(taskDescription);

        // Execute Hermes in background (fire-and-forget with monitoring)
        this.launchHermesProcess(hermesTaskId, taskId, agentId, hermesCommand);

        // Initialize task state
        this.taskStates.set(hermesTaskId, {
          status: 'dispatched',
          progress: 0,
          lastUpdate: new Date(),
          agentId,
        });

        this.emit('task:dispatched', {
          hermesTaskId,
          taskId,
          agentId,
          timestamp: new Date().toISOString(),
        });

        this.logger.log(`Task dispatched successfully: ${hermesTaskId} → agent ${agentId}`);
        return hermesTaskId;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Dispatch attempt ${attempt + 1} failed: ${errorMessage}`);

        if (attempt < this.retryAttempts - 1) {
          const backoffTime = this.retryBackoffMs * Math.pow(2, attempt);
          this.logger.log(`Retrying in ${backoffTime}ms...`);
          await this.sleep(backoffTime);
        }
        attempt++;
      }
    }

    // All retries exhausted
    const errorMsg = `Failed to dispatch task ${hermesTaskId} after ${this.retryAttempts} attempts`;
    this.logger.error(errorMsg);
    throw new HttpException(errorMsg, HttpStatus.SERVICE_UNAVAILABLE);
  }

  /**
   * Launch Hermes process and monitor output
   * Parses CloudEvents from Hermes output and updates local state
   */
  private launchHermesProcess(
    hermesTaskId: string,
    taskId: string,
    agentId: string,
    hermesCommand: string,
  ): void {
    const { spawn } = require('child_process');

    try {
      // Spawn Hermes subprocess
      const hermesProcess = spawn('sh', ['-c', hermesCommand], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: this.hermesTimeout,
      });

      // Track process
      this.taskProcesses.set(hermesTaskId, hermesProcess);

      // Monitor stdout for CloudEvents or task updates
      hermesProcess.stdout.on('data', (data: Buffer) => {
        const output = data.toString('utf-8');
        this.handleHermesOutput(hermesTaskId, taskId, agentId, output);
      });

      // Monitor stderr
      hermesProcess.stderr.on('data', (data: Buffer) => {
        const error = data.toString('utf-8');
        this.logger.warn(`[${hermesTaskId}] stderr: ${error.substring(0, 200)}`);
      });

      // Handle process termination
      hermesProcess.on('close', (code: number) => {
        this.logger.log(`[${hermesTaskId}] Hermes process exited with code ${code}`);
        this.taskProcesses.delete(hermesTaskId);

        // Update final status
        if (code === 0) {
          this.updateTaskStatus(hermesTaskId, 'completed', 100, agentId);
        } else {
          this.updateTaskStatus(hermesTaskId, 'failed', 0, agentId);
        }
      });

      // Handle process errors
      hermesProcess.on('error', (error: Error) => {
        this.logger.error(`[${hermesTaskId}] Process error: ${error.message}`);
        this.updateTaskStatus(hermesTaskId, 'failed', 0, agentId);
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to spawn Hermes process: ${errorMessage}`);
      this.updateTaskStatus(hermesTaskId, 'failed', 0, agentId);
      throw error;
    }
  }

  /**
   * Handle output from Hermes process
   * Parses for status updates and CloudEvents
   */
  private handleHermesOutput(
    hermesTaskId: string,
    taskId: string,
    agentId: string,
    output: string,
  ): void {
    try {
      // Look for CloudEvent JSON
      const cloudEventMatch = output.match(/\{[^{}]*"specversion"[^{}]*\}/);
      if (cloudEventMatch) {
        const cloudEvent = JSON.parse(cloudEventMatch[0]);
        this.processCloudEvent(hermesTaskId, taskId, agentId, cloudEvent);
      }

      // Look for progress indicators
      const progressMatch = output.match(/progress[:\s=]+(\d+)/i);
      if (progressMatch) {
        const progress = parseInt(progressMatch[1], 10);
        this.updateTaskStatus(hermesTaskId, 'running', progress, agentId);
      }

      // Log significant output
      if (output.length > 10) {
        this.logger.debug(`[${hermesTaskId}] Output: ${output.substring(0, 100)}`);
      }
    } catch (error) {
      this.logger.debug(
        `Failed to parse Hermes output: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Process CloudEvent from Hermes
   * Format: CloudEvents v1.0 (application/json)
   */
  private processCloudEvent(
    hermesTaskId: string,
    taskId: string,
    agentId: string,
    cloudEvent: any,
  ): void {
    try {
      const { type, data } = cloudEvent;

      if (!type) {
        this.logger.warn(`CloudEvent missing type field`);
        return;
      }

      switch (type) {
        case 'task.started':
          this.updateTaskStatus(hermesTaskId, 'running', 10, agentId);
          break;
        case 'task.progress':
          const progress = data?.progress || 50;
          this.updateTaskStatus(hermesTaskId, 'running', progress, agentId);
          break;
        case 'task.completed':
          this.updateTaskStatus(hermesTaskId, 'completed', 100, agentId);
          this.emit('task:completed', {
            hermesTaskId,
            taskId,
            result: data?.result,
            timestamp: new Date().toISOString(),
          });
          break;
        case 'task.failed':
          this.updateTaskStatus(hermesTaskId, 'failed', 0, agentId);
          this.emit('task:failed', {
            hermesTaskId,
            taskId,
            error: data?.error,
            timestamp: new Date().toISOString(),
          });
          break;
        case 'agent.heartbeat':
          this.updateAgentHeartbeat(agentId, data?.status || 'working');
          break;
      }

      this.logger.debug(`CloudEvent processed: ${type}`);
    } catch (error) {
      this.logger.warn(
        `Failed to process CloudEvent: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get task status from cache
   * Returns status or 'unknown' if not found
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
      this.logger.warn(`Task ${hermesTaskId} not found in cache`);
      return {
        status: 'unknown',
        progress: 0,
        lastUpdate: new Date(),
      };
    }

    return {
      status: state.status,
      progress: state.progress,
      lastUpdate: state.lastUpdate,
    };
  }

  /**
   * Get agent status from cache
   */
  async getAgentStatus(
    agentId: string,
  ): Promise<{
    agentId: string;
    status: string;
    currentTask?: string;
    capabilities: string[];
  }> {
    const state = this.agentStates.get(agentId);

    return (
      state || {
        agentId,
        status: 'idle',
        capabilities: [],
      }
    );
  }

  /**
   * Send signal to agent (pause/resume/cancel)
   * For now, just logs (will connect to Hermes API in future)
   */
  async sendSignal(
    agentId: string,
    signal: 'pause' | 'resume' | 'cancel',
  ): Promise<void> {
    try {
      const agentState = this.agentStates.get(agentId);

      if (!agentState) {
        this.logger.warn(`Agent ${agentId} not found in cache`);
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
      this.emit('agent:signal', { agentId, signal, timestamp: new Date().toISOString() });

      this.logger.log(`Signal sent to agent ${agentId}: ${signal}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to send signal: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Get list of idle agents
   */
  async getIdleAgents(): Promise<string[]> {
    const idleAgents = Array.from(this.agentStates.values())
      .filter((state) => state.status === 'idle')
      .map((state) => state.agentId);

    return idleAgents;
  }

  /**
   * Internal: Update task status in cache and emit events
   */
  private updateTaskStatus(hermesTaskId: string, status: string, progress: number, agentId: string): void {
    const state = this.taskStates.get(hermesTaskId);

    if (state) {
      state.status = status;
      state.progress = progress;
      state.lastUpdate = new Date();
      this.taskStates.set(hermesTaskId, state);

      this.emit('task:status-changed', {
        hermesTaskId,
        agentId,
        status,
        progress,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Internal: Update agent heartbeat
   */
  private updateAgentHeartbeat(agentId: string, status: string): void {
    let agentState = this.agentStates.get(agentId);

    if (!agentState) {
      agentState = {
        agentId,
        status,
        capabilities: [],
        lastHeartbeat: new Date(),
      };
    } else {
      agentState.lastHeartbeat = new Date();
      if (status) {
        agentState.status = status;
      }
    }

    this.agentStates.set(agentId, agentState);
    this.emit('agent:heartbeat', {
      agentId,
      status,
      lastHeartbeat: new Date().toISOString(),
    });
  }

  /**
   * Helper: Build Hermes CLI command
   */
  private buildHermesCommand(taskDescription: string): string {
    const escapedDescription = taskDescription.replace(/"/g, '\\"').replace(/\n/g, ' ');
    return `${this.hermesCliPath} chat -q "${escapedDescription}"`;
  }

  /**
   * Helper: Sleep for given milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Cleanup: Cancel all running tasks (for graceful shutdown)
   */
  async cleanup(): Promise<void> {
    this.logger.log('Cleaning up Hermes processes...');

    for (const [hermesTaskId, process] of this.taskProcesses.entries()) {
      try {
        process.kill('SIGTERM');
        this.logger.log(`Terminated process for task ${hermesTaskId}`);
      } catch (error) {
        this.logger.warn(
          `Failed to terminate process for task ${hermesTaskId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.taskProcesses.clear();
    this.logger.log('Cleanup complete');
  }

  /**
   * Get debug info (for testing)
   */
  getDebugInfo(): {
    taskCount: number;
    agentCount: number;
    processCount: number;
    tasks: any[];
    agents: any[];
  } {
    return {
      taskCount: this.taskStates.size,
      agentCount: this.agentStates.size,
      processCount: this.taskProcesses.size,
      tasks: Array.from(this.taskStates.entries()).map(([id, state]) => ({ id, ...state })),
      agents: Array.from(this.agentStates.entries()).map(([id, state]) => ({ id, ...state })),
    };
  }
}
