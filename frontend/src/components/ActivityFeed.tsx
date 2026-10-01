import React from 'react';

interface ActivityEvent {
  id: string;
  timestamp: string;
  message: string;
  type: string;
}

interface ActivityFeedProps {
  events: ActivityEvent[];
  maxEvents?: number;
}

export const ActivityFeed: React.FC<ActivityFeedProps> = ({ events, maxEvents = 10 }) => {
  const recentEvents = events.slice(0, maxEvents);

  return (
    <div className="bg-gray-800 p-4 rounded border border-gray-700 max-h-64 overflow-y-auto">
      <h3 className="text-lg font-bold text-white mb-4">Activity Feed</h3>
      <div className="space-y-3">
        {recentEvents.length === 0 ? (
          <p className="text-gray-400 text-sm">No activity yet</p>
        ) : (
          recentEvents.map(event => (
            <div key={event.id} className="flex gap-3 text-sm border-l border-gray-600 pl-3">
              <div className="text-gray-500 min-w-fit">
                {new Date(event.timestamp).toLocaleTimeString()}
              </div>
              <div className="text-gray-300">{event.message}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
