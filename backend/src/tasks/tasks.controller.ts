import { Controller, Post, Get, Body, Param, BadRequestException, HttpStatus } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto, UpdateTaskStatusDto } from './dto/create-task.dto';
import { Task } from '../entities/task.entity';

/**
 * Tasks Controller - REST API endpoints for task management
 * Endpoints:
 *   POST /api/tasks - Create a new task
 *   GET /api/tasks - List all root tasks
 *   GET /api/tasks/:id - Get a specific task with subtasks
 *   GET /api/tasks/:id/subtasks - Get subtasks for a task
 *   PATCH /api/tasks/:id/status - Update task status
 */
@Controller('api/tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  /**
   * POST /api/tasks
   * Create a new task from operator input
   * Validation: title min 10 chars, priority enum
   * Returns: Created task with id and status='created'
   */
  @Post()
  async create(@Body() createTaskDto: CreateTaskDto): Promise<{
    id: string;
    title: string;
    status: string;
    priority: string;
    created_at: Date;
    message: string;
  }> {
    const task = await this.tasksService.createTask(createTaskDto);

    return {
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority || 'medium',
      created_at: task.created_at,
      message: 'Task created successfully',
    };
  }

  /**
   * GET /api/tasks
   * List all root-level tasks (no parent)
   */
  @Get()
  async listTasks(): Promise<{
    tasks: Task[];
    count: number;
  }> {
    const tasks = await this.tasksService.listTasks();
    return {
      tasks,
      count: tasks.length,
    };
  }

  /**
   * GET /api/tasks/:id
   * Get a specific task with all its subtasks
   */
  @Get(':id')
  async getTask(@Param('id') id: string): Promise<Task> {
    return this.tasksService.getTask(id);
  }

  /**
   * GET /api/tasks/:id/subtasks
   * Get all subtasks for a given parent task
   */
  @Get(':id/subtasks')
  async getSubtasks(@Param('id') id: string): Promise<{
    parent_task_id: string;
    subtasks: Task[];
    count: number;
  }> {
    const subtasks = await this.tasksService.getSubtasks(id);
    return {
      parent_task_id: id,
      subtasks,
      count: subtasks.length,
    };
  }

  /**
   * PATCH /api/tasks/:id/status
   * Update task status with state machine validation
   */
  @Post(':id/status')
  async updateStatus(@Param('id') id: string, @Body() updateStatusDto: UpdateTaskStatusDto): Promise<Task> {
    return this.tasksService.updateTaskStatus(id, updateStatusDto);
  }
}
