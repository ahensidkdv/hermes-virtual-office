import React from 'react';
import { useOfficeStore } from '../store/office.store';
import { useWebSocket } from '../hooks/useWebSocket';
import { useAgents } from '../hooks/useAgents';
import { useTasks } from '../hooks/useTasks';
import { OfficeCanvas } from '../components/OfficeCanvas';
import { TaskInputForm } from '../components/TaskInputForm';
import { DetailPanel } from '../components/DetailPanel';

export const OfficePage: React.FC = () => {
  // Initialize WebSocket connection
  useWebSocket();

  // Fetch initial data
  const agents = useAgents();
  const tasks = useTasks();

  // UI State
  const selectedAgentId = useOfficeStore(s => s.selectedAgentId);
  const isDetailPanelOpen = useOfficeStore(s => s.isDetailPanelOpen);
  const setSelectedAgent = useOfficeStore(s => s.setSelectedAgent);
  const closeDetailPanel = useOfficeStore(s => s.closeDetailPanel);

  const selectedAgent = agents.find(a => a.id === selectedAgentId) || null;
  const selectedTask = selectedAgent?.current_task_id 
    ? (tasks.find(t => t.id === selectedAgent.current_task_id) || null)
    : null;

  const activeAgents = agents.filter(a => a.status !== 'idle').length;
  const activeTasks = tasks.filter(t => t.status === 'in_progress').length;

  return (
    <div className="w-full h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-white">🏢 Hermes Virtual Office</h1>
            <p className="text-gray-400 text-sm mt-1">Real-time agent coordination system</p>
          </div>
          <div className="flex gap-8 text-sm">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-400">{agents.length}</div>
              <div className="text-gray-400">Agents</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-400">{activeAgents}</div>
              <div className="text-gray-400">Active</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-400">{activeTasks}</div>
              <div className="text-gray-400">Tasks</div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden p-6 gap-6">
        {/* Canvas Area */}
        <div className="flex-1 flex flex-col gap-6">
          <OfficeCanvas
            agents={agents}
            onAgentClick={(agentId) => setSelectedAgent(agentId)}
          />
          
          {/* Task Form */}
          <TaskInputForm />
        </div>

        {/* Detail Panel */}
        {isDetailPanelOpen && (
          <DetailPanel agent={selectedAgent} task={selectedTask} />
        )}
      </div>

      {/* Click outside to close detail panel */}
      {isDetailPanelOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => closeDetailPanel()}
        />
      )}
    </div>
  );
};
