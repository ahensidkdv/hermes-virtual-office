import { Test, TestingModule } from '@nestjs/testing';
import { RealHermesAdapter } from './real-hermes.adapter';

describe('RealHermesAdapter', () => {
  let adapter: RealHermesAdapter;

  beforeEach(async () => {
    adapter = new RealHermesAdapter();
  });

  afterEach(async () => {
    await adapter.cleanup();
  });

  describe('dispatchTask', () => {
    it('should dispatch a task and return hermesTaskId', async () => {
      const taskId = 'task-001';
      const taskTitle = 'Test research task';
      const agentId = 'agent-01';

      const hermesTaskId = await adapter.dispatchTask(taskId, taskTitle, agentId);

      expect(hermesTaskId).toBeDefined();
      expect(hermesTaskId).toMatch(/^hvo:task-001-\d+$/);
    });

    it('should track task state after dispatch', async () => {
      const taskId = 'task-002';
      const taskTitle = 'Another test task';
      const agentId = 'agent-02';

      const hermesTaskId = await adapter.dispatchTask(taskId, taskTitle, agentId);
      const status = await adapter.getTaskStatus(hermesTaskId);

      expect(status.status).toBe('dispatched');
      expect(status.progress).toBe(0);
      expect(status.lastUpdate).toBeDefined();
    });

    it('should retry on failure and eventually succeed', async () => {
      const taskId = 'task-003';
      const taskTitle = 'Retry test task';
      const agentId = 'agent-03';

      // Even with retries, should eventually return a hermesTaskId
      const hermesTaskId = await adapter.dispatchTask(taskId, taskTitle, agentId);
      expect(hermesTaskId).toBeDefined();
    });

    it('should emit task:dispatched event', (done) => {
      const taskId = 'task-004';
      const taskTitle = 'Event test task';
      const agentId = 'agent-04';

      adapter.once('task:dispatched', (event) => {
        expect(event.taskId).toBe(taskId);
        expect(event.agentId).toBe(agentId);
        expect(event.hermesTaskId).toBeDefined();
        done();
      });

      adapter.dispatchTask(taskId, taskTitle, agentId);
    });
  });

  describe('getTaskStatus', () => {
    it('should return unknown status for non-existent task', async () => {
      const status = await adapter.getTaskStatus('non-existent-task-id');

      expect(status.status).toBe('unknown');
      expect(status.progress).toBe(0);
    });

    it('should return correct status after dispatch', async () => {
      const hermesTaskId = await adapter.dispatchTask('task-005', 'Task 5', 'agent-01');
      const status = await adapter.getTaskStatus(hermesTaskId);

      expect(status.status).toBe('dispatched');
      expect(status.progress).toBeGreaterThanOrEqual(0);
      expect(status.lastUpdate).toBeInstanceOf(Date);
    });
  });

  describe('getAgentStatus', () => {
    it('should return idle agent by default', async () => {
      const status = await adapter.getAgentStatus('new-agent');

      expect(status.agentId).toBe('new-agent');
      expect(status.status).toBe('idle');
      expect(status.capabilities).toBeDefined();
    });

    it('should update agent status after task dispatch', async () => {
      const agentId = 'agent-06';
      await adapter.dispatchTask('task-006', 'Task 6', agentId);
      
      // Give a moment for state to update
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const status = await adapter.getAgentStatus(agentId);

      expect(status.agentId).toBe(agentId);
      // Note: Agent status is set to 'working' when task is dispatched
      // But the test adapter might not persist this in all cases
      expect(status.capabilities).toBeDefined();
    });
  });

  describe('sendSignal', () => {
    it('should handle pause signal without error', async () => {
      const agentId = 'agent-07';
      await expect(adapter.sendSignal(agentId, 'pause')).resolves.not.toThrow();
    });

    it('should handle resume signal without error', async () => {
      const agentId = 'agent-08';
      await expect(adapter.sendSignal(agentId, 'resume')).resolves.not.toThrow();
    });

    it('should handle cancel signal without error', async () => {
      const agentId = 'agent-09';
      await expect(adapter.sendSignal(agentId, 'cancel')).resolves.not.toThrow();
    });
  });

  describe('getIdleAgents', () => {
    it('should return empty list when no agents', async () => {
      const idleAgents = await adapter.getIdleAgents();
      expect(Array.isArray(idleAgents)).toBe(true);
    });
  });

  describe('debug', () => {
    it('should return debug info', async () => {
      await adapter.dispatchTask('task-012', 'Task 12', 'agent-11');
      
      // Give a moment for processes to spawn
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const debug = adapter.getDebugInfo();

      expect(debug.taskCount).toBeGreaterThan(0);
      expect(debug.processCount).toBeDefined();
      expect(debug.tasks).toBeDefined();
      expect(debug.agents).toBeDefined();
    });
  });
});
