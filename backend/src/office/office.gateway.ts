import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { Redis } from 'ioredis';
import { OfficeService } from './office.service';

/**
 * WebSocket Gateway for real-time office updates
 * Path: /ws/office
 * Events:
 *   - agent:move → broadcast position changes
 *   - agent:status → broadcast status changes
 *   - task:assigned → broadcast task assignments
 * 
 * Latency requirement: < 500ms via Redis pub/sub
 */
@WebSocketGateway({
  namespace: 'ws/office',
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
})
export class OfficeGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  private readonly logger = new Logger(OfficeGateway.name);
  private subscriber: Redis;
  private connectedClients = new Map<string, Socket>();

  @WebSocketServer()
  server!: Server;

  constructor(private officeService: OfficeService) {
    // Separate Redis subscriber for pub/sub
    this.subscriber = new (require('ioredis'))(
      {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD,
      },
    );
  }

  /**
   * Initialize gateway
   * Subscribe to office events on Redis
   */
  async onModuleInit(): Promise<void> {
    try {
      // Subscribe to office events channel
      await this.subscriber.subscribe('hvo:office:events');
      this.logger.log('Subscribed to hvo:office:events channel');

      // Listen for Redis pub/sub messages
      this.subscriber.on('message', (channel: string, message: string) => {
        if (channel === 'hvo:office:events') {
          try {
            const event = JSON.parse(message);
            this.broadcastToClients(event);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to parse office event: ${errorMessage}`);
          }
        }
      });

      this.logger.log('OfficeGateway initialized and listening for events');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to initialize OfficeGateway: ${errorMessage}`);
    }
  }

  /**
   * Handle client connection
   * Track connected clients for broadcast
   */
  handleConnection(client: Socket): void {
    this.connectedClients.set(client.id, client);
    this.logger.log(`Client connected: ${client.id} (total: ${this.connectedClients.size})`);

    // Send connection acknowledgment
    client.emit('connection:ack', {
      message: 'Connected to Hermes Virtual Office',
      clientId: client.id,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle client disconnect
   * Cleanup subscriptions for disconnected client
   */
  handleDisconnect(client: Socket): void {
    this.connectedClients.delete(client.id);
    this.logger.log(`Client disconnected: ${client.id} (total: ${this.connectedClients.size})`);
  }

  /**
   * Broadcast event to all connected clients
   * Handles agent:move, agent:status, task:assigned events
   */
  private broadcastToClients(event: any): void {
    if (this.connectedClients.size === 0) {
      return; // No clients to broadcast to
    }

    this.server.emit(event.type, event);
    this.logger.debug(`Broadcasted ${event.type} to ${this.connectedClients.size} clients`);
  }

  /**
   * Subscribe to agent position updates (client-side)
   */
  @SubscribeMessage('subscribe:agent:position')
  subscribeAgentPosition(client: Socket, data: { agentId: string }): void {
    const room = `agent:${data.agentId}:position`;
    client.join(room);
    this.logger.debug(`Client ${client.id} subscribed to ${room}`);
  }

  /**
   * Unsubscribe from agent position updates (client-side)
   */
  @SubscribeMessage('unsubscribe:agent:position')
  unsubscribeAgentPosition(client: Socket, data: { agentId: string }): void {
    const room = `agent:${data.agentId}:position`;
    client.leave(room);
    this.logger.debug(`Client ${client.id} unsubscribed from ${room}`);
  }

  /**
   * Subscribe to all office events (client-side)
   */
  @SubscribeMessage('subscribe:office:events')
  subscribeOfficeEvents(client: Socket): void {
    const room = 'office:events';
    client.join(room);
    this.logger.debug(`Client ${client.id} subscribed to ${room}`);
    
    client.emit('subscribe:ack', {
      message: 'Subscribed to office events',
      room,
    });
  }

  /**
   * Get connected clients count
   */
  getConnectedClientsCount(): number {
    return this.connectedClients.size;
  }

  /**
   * Cleanup on module destroy
   */
  async onModuleDestroy(): Promise<void> {
    await this.subscriber.unsubscribe();
    await this.subscriber.quit();
  }
}
