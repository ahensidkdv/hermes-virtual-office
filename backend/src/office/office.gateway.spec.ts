import { Test, TestingModule } from '@nestjs/testing';
import { OfficeGateway } from './office.gateway';
import { OfficeService } from './office.service';

describe('OfficeGateway', () => {
  let gateway: OfficeGateway;
  let mockOfficeService: any;
  let mockSocket: any;

  beforeEach(async () => {
    mockOfficeService = {
      broadcastAgentMove: jest.fn(),
      broadcastAgentStatus: jest.fn(),
      broadcastTaskAssigned: jest.fn(),
      getAgentPosition: jest.fn(),
    };

    mockSocket = {
      id: 'socket-01',
      emit: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OfficeGateway,
        {
          provide: OfficeService,
          useValue: mockOfficeService,
        },
      ],
    }).compile();

    gateway = module.get<OfficeGateway>(OfficeGateway);
    // Mock WebSocketServer
    gateway.server = {
      emit: jest.fn(),
    } as any;
  });

  describe('handleConnection', () => {
    it('should add client to connected clients map', () => {
      gateway.handleConnection(mockSocket);

      expect(gateway.getConnectedClientsCount()).toBe(1);
      expect(mockSocket.emit).toHaveBeenCalledWith('connection:ack', expect.any(Object));
    });

    it('should increment connected clients count', () => {
      gateway.handleConnection(mockSocket);
      const socket2 = { id: 'socket-02', emit: jest.fn(), join: jest.fn(), leave: jest.fn() };
      gateway.handleConnection(socket2);

      expect(gateway.getConnectedClientsCount()).toBe(2);
    });
  });

  describe('handleDisconnect', () => {
    it('should remove client from connected clients map', () => {
      gateway.handleConnection(mockSocket);
      gateway.handleDisconnect(mockSocket);

      expect(gateway.getConnectedClientsCount()).toBe(0);
    });
  });

  describe('subscribeAgentPosition', () => {
    it('should subscribe client to agent position room', () => {
      gateway.subscribeAgentPosition(mockSocket, { agentId: 'agent-01' });

      expect(mockSocket.join).toHaveBeenCalledWith('agent:agent-01:position');
    });
  });

  describe('unsubscribeAgentPosition', () => {
    it('should unsubscribe client from agent position room', () => {
      gateway.unsubscribeAgentPosition(mockSocket, { agentId: 'agent-01' });

      expect(mockSocket.leave).toHaveBeenCalledWith('agent:agent-01:position');
    });
  });

  describe('subscribeOfficeEvents', () => {
    it('should subscribe client to office events room', () => {
      gateway.subscribeOfficeEvents(mockSocket);

      expect(mockSocket.join).toHaveBeenCalledWith('office:events');
      expect(mockSocket.emit).toHaveBeenCalledWith('subscribe:ack', expect.any(Object));
    });
  });
});
