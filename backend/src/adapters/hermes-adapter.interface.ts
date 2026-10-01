/**
 * Hermes Adapter Interface
 * Defines contract for task dispatch, agent status queries, and signaling
 * Phase 0-1: Mock implementation (in-memory)
 * Phase 2+: Real Hermes runtime integration
 */
export interface HermesAdapterInterface {
  /**
   * Dispatch a task to Hermes runtime
   * Returns hermes_task_id for tracking
   */
  dispatchTask(
    taskId: string,
    taskTitle: string,
    agentId: string,
    metadata?: Record<string, any>,
  ): Promise<string>;

  /**
   * Get current status of a task in Hermes
   */
  getTaskStatus(
    hermesTaskId: string,
  ): Promise<{
    status: string;
    progress: number;
    lastUpdate: Date;
  }>;

  /**
   * Get agent status in Hermes
   */
  getAgentStatus(
    agentId: string,
  ): Promise<{
    agentId: string;
    status: string;
    currentTask?: string;
    capabilities: string[];
  }>;

  /**
   * Send signal to agent (pause/resume/cancel)
   */
  sendSignal(
    agentId: string,
    signal: 'pause' | 'resume' | 'cancel',
  ): Promise<void>;

  /**
   * Get list of idle agents available for task assignment
   */
  getIdleAgents(): Promise<string[]>;
}
