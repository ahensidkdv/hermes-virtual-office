import React, { useState } from 'react';

interface TooltipProps {
  children: React.ReactNode;
  content: string | React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export const Tooltip: React.FC<TooltipProps> = ({ children, content, position = 'top' }) => {
  const [isVisible, setIsVisible] = useState(false);

  const positionClass = {
    top: 'bottom-full mb-2',
    bottom: 'top-full mt-2',
    left: 'right-full mr-2',
    right: 'left-full ml-2'
  }[position];

  return (
    <div className="relative inline-block">
      <div
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
      >
        {children}
      </div>

      {isVisible && (
        <div className={`absolute ${positionClass} bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-50 border border-gray-700`}>
          {content}
          <div className={`absolute w-1 h-1 bg-gray-900 border border-gray-700 transform rotate-45 ${{
            top: '-bottom-0.5 left-1/2 -translate-x-1/2',
            bottom: '-top-0.5 left-1/2 -translate-x-1/2',
            left: '-right-0.5 top-1/2 -translate-y-1/2',
            right: '-left-0.5 top-1/2 -translate-y-1/2'
          }[position]}`} />
        </div>
      )}
    </div>
  );
};
