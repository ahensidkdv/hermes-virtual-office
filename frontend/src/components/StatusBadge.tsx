import React, { useState, useEffect } from 'react';
import { AgentStatus } from '../types';

interface StatusBadgeProps {
  status: AgentStatus;
  isBlocked?: boolean;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, isBlocked = false }) => {
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (isBlocked) {
      setIsAnimating(true);
    }
  }, [isBlocked]);

  const getStatusColor = (status: AgentStatus) => {
    switch (status) {
      case 'idle':
        return 'bg-blue-500';
      case 'working':
        return 'bg-green-500';
      case 'discussing':
        return 'bg-yellow-500';
      case 'blocked':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold text-white ${getStatusColor(status)} ${isAnimating && isBlocked ? 'animate-pulse' : ''}`}>
      <span className="inline-block w-2 h-2 rounded-full bg-white"></span>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </div>
  );
};
