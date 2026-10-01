import React from 'react';

interface DashboardProps {
  totalAgents: number;
  activeAgents: number;
  activeTasks: number;
  uptime: string;
}

export const Dashboard: React.FC<DashboardProps> = ({
  totalAgents,
  activeAgents,
  activeTasks,
  uptime
}) => {
  return (
    <div className="grid grid-cols-4 gap-4 mb-6">
      <div className="bg-gray-800 p-4 rounded border border-gray-700">
        <div className="text-gray-400 text-sm">Total Agents</div>
        <div className="text-3xl font-bold text-white mt-2">{totalAgents}</div>
      </div>
      <div className="bg-gray-800 p-4 rounded border border-gray-700">
        <div className="text-gray-400 text-sm">Active</div>
        <div className="text-3xl font-bold text-green-400 mt-2">{activeAgents}</div>
      </div>
      <div className="bg-gray-800 p-4 rounded border border-gray-700">
        <div className="text-gray-400 text-sm">Tasks</div>
        <div className="text-3xl font-bold text-blue-400 mt-2">{activeTasks}</div>
      </div>
      <div className="bg-gray-800 p-4 rounded border border-gray-700">
        <div className="text-gray-400 text-sm">Uptime</div>
        <div className="text-lg font-bold text-yellow-400 mt-2">{uptime}</div>
      </div>
    </div>
  );
};
