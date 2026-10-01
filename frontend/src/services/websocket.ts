import { io, Socket } from 'socket.io-client';

const WS_URL = (import.meta.env.VITE_WS_URL as string) || 'ws://localhost:3001';

class WebSocketService {
  private socket: Socket | null = null;

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = io(WS_URL, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5
      });

      this.socket.on('connection:ack', () => {
        console.log('✅ Connected to office');
        this.subscribe();
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        console.error('WebSocket connection error:', error);
        reject(error);
      });

      this.socket.on('disconnect', () => {
        console.log('❌ Disconnected from office');
      });
    });
  }

  private subscribe(): void {
    if (!this.socket) return;
    this.socket.emit('subscribe:office:events', {});
  }

  on(event: string, callback: (data: any) => void): void {
    if (!this.socket) return;
    this.socket.on(event, callback);
  }

  off(event: string, callback: (data: any) => void): void {
    if (!this.socket) return;
    this.socket.off(event, callback);
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}

export const wsService = new WebSocketService();
