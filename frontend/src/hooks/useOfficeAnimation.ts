import { useEffect } from 'react';
import { useOfficeStore } from '../store/office.store';
import { wsService } from '../services/websocket';
import { pixiRenderer } from '../services/pixijs-renderer';
import { AgentMoveEvent, AgentStatusEvent } from '../types';

/**
 * Hook to handle WebSocket events and trigger PixiJS animations
 */
export function useOfficeAnimation() {
  const updateAgentPosition = useOfficeStore(s => s.updateAgentPosition);
  const updateAgentStatus = useOfficeStore(s => s.updateAgentStatus);

  useEffect(() => {
    const handleAgentMove = (event: AgentMoveEvent) => {
      console.log(`📍 Agent ${event.agentId} moving to (${event.position_x}, ${event.position_y})`);
      
      // Trigger smooth animation (2.5 sec)
      pixiRenderer.animateAgent(event.agentId, event.position_x, event.position_y, 2500);
      
      // Update store
      updateAgentPosition(event.agentId, event.position_x, event.position_y, event.room);
    };

    const handleAgentStatus = (event: AgentStatusEvent) => {
      console.log(`🟢 Agent ${event.agentId} status: ${event.status}`);
      updateAgentStatus(event.agentId, event.status);
    };

    wsService.on('agent:move', handleAgentMove);
    wsService.on('agent:status', handleAgentStatus);

    return () => {
      wsService.off('agent:move', handleAgentMove);
      wsService.off('agent:status', handleAgentStatus);
    };
  }, [updateAgentPosition, updateAgentStatus]);
}
