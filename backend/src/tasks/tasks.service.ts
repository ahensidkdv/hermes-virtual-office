import { Injectable, Logger, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Task, TaskStatus } from '../entities/task.entity';
import { CreateTaskDto, UpdateTaskStatusDto } from './dto/create-task.dto';
import { CloudEventService } from '../events/cloud-event.service';

/**
 * Tasks Service - Handles CRUD operations and task lifecycle state machine
 * Publishes events to Redis on task creation and status changes
 */
@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(Task)
    private taskRepository: Repository<Task>,
    private cloudEventService: CloudEventService,
  ) {}

  /**
   * Create a new task in the database and publish task.created event
   * @param createTaskDto - Task creation data
   * @returns Created task
   */
  async createTask(createTaskDto: CreateTaskDto): Promise<Task> {
    try {
      const task = this.taskRepository.create({
        title: createTaskDto.title,
        description: createTaskDto.description,
        priority: createTaskDto.priority || 'medium',
        status: 'created',
      });

      const savedTask = await this.taskRepository.save(task);
      this.logger.log(`Task created: ${savedTask.id} - ${savedTask.title}`);

      // Publish CloudEvent to Redis
      await this.cloudEventService.publishTaskCreated(savedTask);

      return savedTask;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : '';
      this.logger.error(`Failed to create task: ${errorMessage}`, errorStack);
      throw error;
    }
  }

  /**
   * Retrieve a task by ID with its subtasks
   * @param id - Task ID
   * @returns Task with subtasks
   */
  async getTask(id: string): Promise<Task> {
    const task = await this.taskRepository.findOne({
      where: { id },
      relations: ['subtasks'],
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    return task;
  }

  /**
   * Get all subtasks for a given parent task
   * @param parentTaskId - Parent task ID
   * @returns List of subtasks
   */
  async getSubtasks(parentTaskId: string): Promise<Task[]> {
    return this.taskRepository.find({
      where: { parent_task_id: parentTaskId },
      order: { created_at: 'ASC' },
    });
  }

  /**
   * List all tasks with optional filtering
   * @param status - Optional status filter
   * @returns List of tasks
   */
  async listTasks(status?: TaskStatus): Promise<Task[]> {
    const query = this.taskRepository.createQueryBuilder('task').where('task.parent_task_id IS NULL');

    if (status) {
      query.andWhere('task.status = :status', { status });
    }

    return query.orderBy('task.created_at', 'DESC').getMany();
  }

  /**
   * Update task status with proper state machine validation
   * @param id - Task ID
   * @param updateStatusDto - New status
   * @returns Updated task
   */
  async updateTaskStatus(id: string, updateStatusDto: UpdateTaskStatusDto): Promise<Task> {
    const task = await this.getTask(id);

    const validTransitions: Record<TaskStatus, TaskStatus[]> = {
      created: ['assigned', 'in_progress'],
      assigned: ['in_progress', 'created'],
      in_progress: ['review', 'created'],
      review: ['done', 'in_progress'],
      done: [],
    };

    const allowedTransitions = validTransitions[task.status];
    if (!allowedTransitions.includes(updateStatusDto.status as TaskStatus)) {
      throw new ConflictException(
        `Cannot transition from ${task.status} to ${updateStatusDto.status}`,
      );
    }

    task.status = updateStatusDto.status as TaskStatus;
    task.updated_at = new Date();

    if (updateStatusDto.status === 'done') {
      task.completed_at = new Date();
    }

    const updatedTask = await this.taskRepository.save(task);
    this.logger.log(`Task ${id} status updated to ${updateStatusDto.status}`);

    // Publish status change event
    await this.cloudEventService.publishTaskStatusChanged(updatedTask);

    return updatedTask;
  }

  /**
   * Create multiple subtasks for a parent task
   * Used by Manager Agent for task decomposition
   * @param parentTaskId - Parent task ID
   * @param subtaskTitles - Array of subtask titles
   * @returns Created subtasks
   */
  async createSubtasks(parentTaskId: string, subtaskTitles: string[]): Promise<Task[]> {
    const parentTask = await this.getTask(parentTaskId);

    if (!parentTask) {
      throw new NotFoundException(`Parent task ${parentTaskId} not found`);
    }

    const subtasks = subtaskTitles.map(title =>
      this.taskRepository.create({
        title,
        parent_task_id: parentTaskId,
        priority: parentTask.priority,
        status: 'created',
      }),
    );

    const savedSubtasks = await this.taskRepository.save(subtasks);
    this.logger.log(
      `Created ${savedSubtasks.length} subtasks for parent task ${parentTaskId}`,
    );

    return savedSubtasks;
  }

  /**
   * Delete a task and cascade to subtasks
   * @param id - Task ID
   */
  async deleteTask(id: string): Promise<void> {
    const task = await this.getTask(id);
    await this.taskRepository.remove(task);
    this.logger.log(`Task ${id} deleted`);
  }
}
