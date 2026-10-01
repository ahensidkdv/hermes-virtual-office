import React from 'react';
import { useOfficeStore } from '../store/office.store';
import { Agent, Task } from '../types';

interface DetailPanelProps {
  agent: Agent | null;
  task: Task | null;
}

export const DetailPanel: React.FC<DetailPanelProps> = ({ agent, task }) => {
  const closeDetailPanel = useOfficeStore(s => s.closeDetailPanel);

  if (!agent) {
    return null;
  }

  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-gray-800 border-l border-gray-700 shadow-lg overflow-auto z-50">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-2xl font-bold text-white">{agent.name}</h2>
            <p className="text-sm text-gray-400">{agent.role}</p>
          </div>
          <button
            onClick={closeDetailPanel}
            className="text-gray-400 hover:text-white text-2xl"
          >
            ✕
          </button>
        </div>

        {/* Status */}
        <div className="bg-gray-700 p-4 rounded">
          <div className="text-sm text-gray-400 mb-2">Status</div>
          <div className="flex items-center gap-2">
            <span className={`inline-block w-3 h-3 rounded-full ${
              agent.status === 'idle' ? 'bg-blue-500' :
              agent.status === 'working' ? 'bg-green-500' :
              agent.status === 'discussing' ? 'bg-yellow-500' :
              'bg-red-500'
            }`} />
            <span className="text-white font-semibold capitalize">{agent.status}</span>
          </div>
        </div>

        {/* Position */}
        <div className="bg-gray-700 p-4 rounded">
          <div className="text-sm text-gray-400 mb-2">Location</div>
          <div>
            <p className="text-white">{agent.room.replace(/_/g, ' ')}</p>
            <p className="text-sm text-gray-400">({agent.position_x}, {agent.position_y})</p>
          </div>
        </div>

        {/* Current Task */}
        {task && (
          <div className="bg-gray-700 p-4 rounded">
            <div className="text-sm text-gray-400 mb-2">Current Task</div>
            <div>
              <p className="text-white font-semibold">{task.title}</p>
              <p className="text-sm text-gray-400 capitalize">Priority: {task.priority}</p>
              <p className="text-sm text-gray-400 capitalize">Status: {task.status}</p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="grid grid-cols-2 gap-2">
          <button className="px-3 py-2 bg-yellow-600 text-white rounded text-sm hover:bg-yellow-700 transition">
            ⏸ Pause
          </button>
          <button className="px-3 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700 transition">
            ✕ Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
