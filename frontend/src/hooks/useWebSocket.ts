import { useEffect } from 'react';
import { wsService } from '../services/websocket';

/**
 * Initialize WebSocket connection to office backend
 * Animations are handled separately by useOfficeAnimation hook
 */
export function useWebSocket() {
  useEffect(() => {
    const init = async () => {
      try {
        await wsService.connect();
        console.log('✅ WebSocket initialized');
      } catch (error) {
        console.error('❌ Failed to connect to WebSocket:', error);
      }
    };

    init();

    return () => {
      wsService.disconnect();
    };
  }, []);
}
