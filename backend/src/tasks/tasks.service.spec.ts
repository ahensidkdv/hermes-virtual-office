import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TasksService } from './tasks.service';
import { Task } from '../entities/task.entity';
import { CloudEventService } from '../events/cloud-event.service';
import { NotFoundException, ConflictException } from '@nestjs/common';

describe('TasksService', () => {
  let service: TasksService;
  let repository: Repository<Task>;
  let cloudEventService: CloudEventService;

  const mockTask: Task = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    title: 'Conduct comprehensive market research',
    description: 'Research market trends',
    status: 'created',
    priority: 'high',
    parent_task_id: null,
    assigned_agent_id: null,
    hermes_id: null,
    metadata: {},
    created_at: new Date(),
    updated_at: new Date(),
    completed_at: null,
    subtasks: [],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        {
          provide: getRepositoryToken(Task),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
            createQueryBuilder: jest.fn(),
            remove: jest.fn(),
          },
        },
        {
          provide: CloudEventService,
          useValue: {
            publishTaskCreated: jest.fn(),
            publishTaskStatusChanged: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
    repository = module.get<Repository<Task>>(getRepositoryToken(Task));
    cloudEventService = module.get<CloudEventService>(CloudEventService);
  });

  describe('createTask', () => {
    it('should create a task and publish event', async () => {
      const createTaskDto = {
        title: 'Conduct comprehensive market research',
        priority: 'high',
        description: 'Research market trends',
      };

      jest.spyOn(repository, 'create').mockReturnValue(mockTask);
      jest.spyOn(repository, 'save').mockResolvedValue(mockTask);
      jest.spyOn(cloudEventService, 'publishTaskCreated').mockResolvedValue(undefined);

      const result = await service.createTask(createTaskDto);

      expect(result).toEqual(mockTask);
      expect(repository.create).toHaveBeenCalledWith({
        title: createTaskDto.title,
        description: createTaskDto.description,
        priority: createTaskDto.priority,
        status: 'created',
      });
      expect(cloudEventService.publishTaskCreated).toHaveBeenCalledWith(mockTask);
    });

    it('should default priority to medium', async () => {
      const createTaskDto = {
        title: 'Conduct comprehensive market research',
      };

      jest.spyOn(repository, 'create').mockReturnValue({ ...mockTask, priority: 'medium' });
      jest.spyOn(repository, 'save').mockResolvedValue({ ...mockTask, priority: 'medium' });
      jest.spyOn(cloudEventService, 'publishTaskCreated').mockResolvedValue(undefined);

      await service.createTask(createTaskDto);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          priority: 'medium',
        }),
      );
    });
  });

  describe('getTask', () => {
    it('should return task with subtasks', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(mockTask);

      const result = await service.getTask(mockTask.id);

      expect(result).toEqual(mockTask);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: mockTask.id },
        relations: ['subtasks'],
      });
    });

    it('should throw NotFoundException if task not found', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(null);

      await expect(service.getTask('invalid-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getSubtasks', () => {
    it('should return all subtasks for a parent task', async () => {
      const subtasks = [
        {
          ...mockTask,
          id: '550e8400-e29b-41d4-a716-446655440001',
          parent_task_id: mockTask.id,
          title: 'Subtask 1',
        },
      ];

      jest.spyOn(repository, 'find').mockResolvedValue(subtasks);

      const result = await service.getSubtasks(mockTask.id);

      expect(result).toEqual(subtasks);
      expect(repository.find).toHaveBeenCalledWith({
        where: { parent_task_id: mockTask.id },
        order: { created_at: 'ASC' },
      });
    });
  });

  describe('updateTaskStatus', () => {
    it('should update task status with valid transition', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(mockTask);
      jest.spyOn(repository, 'save').mockResolvedValue({ ...mockTask, status: 'assigned' });
      jest.spyOn(cloudEventService, 'publishTaskStatusChanged').mockResolvedValue(undefined);

      const result = await service.updateTaskStatus(mockTask.id, { status: 'assigned' });

      expect(result.status).toBe('assigned');
      expect(cloudEventService.publishTaskStatusChanged).toHaveBeenCalled();
    });

    it('should reject invalid status transition', async () => {
      const doneTask = { ...mockTask, status: 'done' as const };
      jest.spyOn(repository, 'findOne').mockResolvedValue(doneTask);

      await expect(
        service.updateTaskStatus(mockTask.id, { status: 'created' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should set completed_at when status is done', async () => {
      const inProgressTask = { ...mockTask, status: 'in_progress' as const };
      jest.spyOn(repository, 'findOne').mockResolvedValue(inProgressTask);
      jest.spyOn(repository, 'save').mockResolvedValue({ ...inProgressTask, status: 'done', completed_at: new Date() });
      jest.spyOn(cloudEventService, 'publishTaskStatusChanged').mockResolvedValue(undefined);

      const result = await service.updateTaskStatus(mockTask.id, { status: 'done' });

      expect(result.status).toBe('done');
      expect(result.completed_at).toBeDefined();
    });
  });

  describe('createSubtasks', () => {
    it('should create multiple subtasks for parent task', async () => {
      const subtaskTitles = ['Subtask 1', 'Subtask 2', 'Subtask 3'];
      const createdSubtasks = subtaskTitles.map((title, idx) => ({
        ...mockTask,
        id: `550e8400-e29b-41d4-a716-44665544000${idx}`,
        title,
        parent_task_id: mockTask.id,
      }));

      jest.spyOn(repository, 'findOne').mockResolvedValue(mockTask);
      jest.spyOn(repository, 'create').mockReturnValue({} as Task);
      jest.spyOn(repository, 'save').mockResolvedValue(createdSubtasks);

      const result = await service.createSubtasks(mockTask.id, subtaskTitles);

      expect(result).toHaveLength(3);
      expect(repository.save).toHaveBeenCalled();
    });

    it('should throw NotFoundException if parent task not found', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(null);

      await expect(service.createSubtasks('invalid-id', ['Subtask 1'])).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteTask', () => {
    it('should delete task', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(mockTask);
      jest.spyOn(repository, 'remove').mockResolvedValue(mockTask);

      await service.deleteTask(mockTask.id);

      expect(repository.remove).toHaveBeenCalledWith(mockTask);
    });
  });
});
