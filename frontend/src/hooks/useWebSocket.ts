import { useEffect } from 'react';
import { useOfficeStore } from '../store/office.store';
import { wsService } from '../services/websocket';
import { AgentMoveEvent, AgentStatusEvent, TaskAssignedEvent } from '../types';

export function useWebSocket() {
  const updateAgentPosition = useOfficeStore(s => s.updateAgentPosition);
  const updateAgentStatus = useOfficeStore(s => s.updateAgentStatus);
  const addTask = useOfficeStore(s => s.addTask);

  useEffect(() => {
    const init = async () => {
      try {
        await wsService.connect();

        // Listen to agent movement
        wsService.on('agent:move', (event: AgentMoveEvent) => {
          console.log(`📍 Agent ${event.agentId} moved to (${event.position_x}, ${event.position_y})`);
          updateAgentPosition(event.agentId, event.position_x, event.position_y, event.room);
        });

        // Listen to agent status changes
        wsService.on('agent:status', (event: AgentStatusEvent) => {
          console.log(`🟢 Agent ${event.agentId} status: ${event.status}`);
          updateAgentStatus(event.agentId, event.status);
        });

        // Listen to task assignments
        wsService.on('task:assigned', (event: TaskAssignedEvent) => {
          console.log(`📋 Task ${event.taskId} assigned to ${event.agentId}`);
        });
      } catch (error) {
        console.error('Failed to connect to WebSocket:', error);
      }
    };

    init();

    return () => {
      wsService.disconnect();
    };
  }, [updateAgentPosition, updateAgentStatus, addTask]);
}
