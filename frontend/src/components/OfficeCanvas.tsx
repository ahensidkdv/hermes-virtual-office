import React, { useEffect, useRef } from 'react';
import { useOfficeStore } from '../store/office.store';
import { pixiRenderer } from '../services/pixijs-renderer';
import { Agent } from '../types';

interface OfficeCanvasProps {
  agents: Agent[];
  onAgentClick: (agentId: string) => void;
}

export const OfficeCanvas: React.FC<OfficeCanvasProps> = ({ agents, onAgentClick }) => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const selectedAgentId = useOfficeStore(s => s.selectedAgentId);
  const isInitialized = useRef(false);

  useEffect(() => {
    if (!canvasRef.current || isInitialized.current) return;

    const init = async () => {
      try {
        await pixiRenderer.init(canvasRef.current!);
        
        // Draw agents
        agents.forEach(agent => {
          pixiRenderer.drawAgent(agent, agent.id === selectedAgentId);
        });

        // Setup click handler
        const canvas = pixiRenderer.getApp()?.canvas;
        if (canvas) {
          canvas.addEventListener('click', (e) => {
            const app = pixiRenderer.getApp();
            if (!app) return;
            
            const rect = canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) * (app.canvas.width / rect.width);
            const y = (e.clientY - rect.top) * (app.canvas.height / rect.height);

            // Check which agent was clicked
            agents.forEach(agent => {
              const dx = agent.position_x - x;
              const dy = agent.position_y - y;
              const distance = Math.sqrt(dx * dx + dy * dy);
              
              if (distance < 20) {
                onAgentClick(agent.id);
              }
            });
          });
        }

        isInitialized.current = true;
      } catch (error) {
        console.error('Failed to initialize PixiJS:', error);
      }
    };

    init();

    return () => {
      // Cleanup handled in destroy
    };
  }, [agents, selectedAgentId, onAgentClick]);

  // Update when agents change
  useEffect(() => {
    agents.forEach(agent => {
      pixiRenderer.updateAgent(agent);
      if (agent.id === selectedAgentId) {
        pixiRenderer.selectAgent(agent.id);
      }
    });
  }, [agents, selectedAgentId]);

  return (
    <div
      ref={canvasRef}
      className="w-full h-full flex items-center justify-center bg-gray-900 rounded-lg overflow-hidden"
    />
  );
};
