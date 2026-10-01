import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { Agent } from '../entities/agent.entity';
import { CloudEventService } from '../events/cloud-event.service';

describe('AgentsService', () => {
  let service: AgentsService;
  let mockAgentRepository: any;
  let mockCloudEventService: any;

  beforeEach(async () => {
    mockAgentRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      count: jest.fn(),
    };

    mockCloudEventService = {
      publishTaskCreated: jest.fn(),
      publishTaskStatusChanged: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentsService,
        {
          provide: getRepositoryToken(Agent),
          useValue: mockAgentRepository,
        },
        {
          provide: CloudEventService,
          useValue: mockCloudEventService,
        },
      ],
    }).compile();

    service = module.get<AgentsService>(AgentsService);
  });

  describe('getAgent', () => {
    it('should return an agent by ID', async () => {
      const mockAgent = {
        id: 'agent-01',
        name: 'Agent 1',
        role: 'researcher',
        status: 'idle',
        position_x: 100,
        position_y: 100,
        room: 'lobby',
      } as Agent;

      mockAgentRepository.findOne.mockResolvedValue(mockAgent);

      const result = await service.getAgent('agent-01');
      expect(result).toEqual(mockAgent);
      expect(mockAgentRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'agent-01' },
        relations: ['current_task'],
      });
    });

    it('should throw NotFoundException when agent not found', async () => {
      mockAgentRepository.findOne.mockResolvedValue(null);

      expect(service.getAgent('unknown-agent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listAgents', () => {
    it('should return list of all agents', async () => {
      const mockAgents: Agent[] = [
        {
          id: 'agent-01',
          name: 'Agent 1',
          status: 'idle',
        } as Agent,
        {
          id: 'agent-02',
          name: 'Agent 2',
          status: 'idle',
        } as Agent,
      ];

      mockAgentRepository.find.mockResolvedValue(mockAgents);

      const result = await service.listAgents();
      expect(result).toEqual(mockAgents);
      expect(result.length).toBe(2);
    });
  });

  describe('updateAgent', () => {
    it('should update agent position and status', async () => {
      const mockAgent: Agent = {
        id: 'agent-01',
        name: 'Agent 1',
        status: 'idle',
        position_x: 100,
        position_y: 100,
        room: 'lobby',
        updated_at: new Date(),
      } as Agent;

      mockAgentRepository.findOne.mockResolvedValue(mockAgent);
      mockAgentRepository.save.mockResolvedValue({
        ...mockAgent,
        position_x: 200,
        position_y: 150,
        status: 'working',
        room: 'work_desk_1',
      } as Agent);

      const result = await service.updateAgent('agent-01', {
        position_x: 200,
        position_y: 150,
        status: 'working',
        room: 'work_desk_1',
      });

      expect(result.position_x).toBe(200);
      expect(result.position_y).toBe(150);
      expect(result.status).toBe('working');
    });

    it('should throw BadRequestException for invalid status', async () => {
      const mockAgent: Agent = {
        id: 'agent-01',
        status: 'idle',
      } as Agent;

      mockAgentRepository.findOne.mockResolvedValue(mockAgent);

      expect(
        service.updateAgent('agent-01', { status: 'invalid_status' as any }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid room', async () => {
      const mockAgent: Agent = {
        id: 'agent-01',
        status: 'idle',
      } as Agent;

      mockAgentRepository.findOne.mockResolvedValue(mockAgent);

      expect(
        service.updateAgent('agent-01', { room: 'invalid_room' as any }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('assignTask', () => {
    it('should assign a task to an agent', async () => {
      const mockAgent: Agent = {
        id: 'agent-01',
        name: 'Agent 1',
        status: 'idle',
        room: 'lobby',
      } as Agent;

      mockAgentRepository.findOne.mockResolvedValue(mockAgent);
      mockAgentRepository.save.mockResolvedValue({
        ...mockAgent,
        current_task_id: 'task-01',
        status: 'working',
        room: 'work_desk_1',
      } as Agent);

      const result = await service.assignTask('agent-01', 'task-01');

      expect(result.current_task_id).toBe('task-01');
      expect(result.status).toBe('working');
      expect(result.room).toBe('work_desk_1');
    });
  });

  describe('releaseTask', () => {
    it('should release a task from an agent', async () => {
      const mockAgent: Agent = {
        id: 'agent-01',
        name: 'Agent 1',
        status: 'working',
        current_task_id: 'task-01',
        room: 'work_desk_1',
      } as Agent;

      mockAgentRepository.findOne.mockResolvedValue(mockAgent);
      mockAgentRepository.save.mockResolvedValue({
        ...mockAgent,
        current_task_id: undefined,
        status: 'idle',
        room: 'lobby',
      } as Agent);

      const result = await service.releaseTask('agent-01');

      expect(result.current_task_id).toBeUndefined();
      expect(result.status).toBe('idle');
      expect(result.room).toBe('lobby');
    });
  });

  describe('getAgentsByStatus', () => {
    it('should return agents with specific status', async () => {
      const mockAgents: Agent[] = [
        { id: 'agent-01', status: 'idle' } as Agent,
        { id: 'agent-02', status: 'idle' } as Agent,
      ];

      mockAgentRepository.find.mockResolvedValue(mockAgents);

      const result = await service.getAgentsByStatus('idle');

      expect(result).toEqual(mockAgents);
      expect(result.length).toBe(2);
    });
  });
});
