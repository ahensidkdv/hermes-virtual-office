import { Injectable, Logger, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Redis } from 'ioredis';
import { Agent, AgentStatus, AgentRoom } from '../entities/agent.entity';
import { UpdateAgentPositionDto, UpdateAgentStatusDto, CreateAgentDto } from './dto/agent.dto';
import { CloudEventService } from '../events/cloud-event.service';

/**
 * Agents Service - Handles CRUD, position tracking, and mock agent management
 * Persists agent state to PostgreSQL + Redis
 * Publishes WebSocket events via CloudEventService
 */
@Injectable()
export class AgentsService implements OnModuleInit {
  private readonly logger = new Logger(AgentsService.name);
  private redis: Redis;

  constructor(
    @InjectRepository(Agent)
    private agentRepository: Repository<Agent>,
    private cloudEventService: CloudEventService,
  ) {
    this.redis = new (require('ioredis'))(
      {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD,
        retryStrategy: (times: number) => Math.min(times * 50, 2000),
      },
    );

    this.redis.on('error', (err: Error) => {
      this.logger.error(`Redis connection error: ${err.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    // Seed mock agents on startup (idempotent)
    await this.seedMockAgents();
  }

  /**
   * Seed 5 mock agents on startup (idempotent)
   * Agents: agent-01 through agent-05
   */
  private async seedMockAgents(): Promise<void> {
    try {
      const existingCount = await this.agentRepository.count();
      if (existingCount > 0) {
        this.logger.log('Mock agents already seeded, skipping...');
        return;
      }

      const mockAgents = this.generateMockAgents();
      await this.agentRepository.save(mockAgents);

      this.logger.log(`Seeded ${mockAgents.length} mock agents`);

      // Store positions in Redis for persistence
      for (const agent of mockAgents) {
        await this.redis.hset(
          `hvo:agent:${agent.id}`,
          'position_x',
          agent.position_x,
          'position_y',
          agent.position_y,
          'room',
          agent.room,
          'status',
          agent.status,
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to seed mock agents: ${errorMessage}`);
    }
  }

  /**
   * Generate 5 mock agents with pre-defined roles
   */
  private generateMockAgents(): Agent[] {
    const roles = ['researcher', 'engineer', 'reviewer', 'analyst', 'coordinator'];
    const agents: Agent[] = [];

    for (let i = 0; i < 5; i++) {
      const agent = new Agent();
      agent.id = `agent-${String(i + 1).padStart(2, '0')}`;
      agent.name = `Agent ${i + 1}`;
      agent.role = roles[i];
      agent.status = 'idle';
      agent.position_x = 100 + i * 50;
      agent.position_y = 100;
      agent.room = 'lobby';
      agent.capabilities = ['task_execution', 'subtask_decomposition', 'validation'];
      agents.push(agent);
    }

    return agents;
  }

  /**
   * List all agents
   */
  async listAgents(): Promise<Agent[]> {
    return this.agentRepository.find({
      relations: ['current_task'],
      order: { created_at: 'ASC' },
    });
  }

  /**
   * Get agent by ID with current task details
   */
  async getAgent(id: string): Promise<Agent> {
    const agent = await this.agentRepository.findOne({
      where: { id },
      relations: ['current_task'],
    });

    if (!agent) {
      throw new NotFoundException(`Agent with ID ${id} not found`);
    }

    return agent;
  }

  /**
   * Update agent position and/or status
   * Validates enum values and updates Redis cache + database
   */
  async updateAgent(id: string, updateDto: UpdateAgentPositionDto): Promise<Agent> {
    const agent = await this.getAgent(id);

    // Validate status enum
    const validStatuses: AgentStatus[] = ['idle', 'working', 'discussing', 'blocked'];
    if (updateDto.status && !validStatuses.includes(updateDto.status)) {
      throw new BadRequestException(`Invalid status: ${updateDto.status}`);
    }

    // Validate room enum
    const validRooms: AgentRoom[] = [
      'lobby',
      'work_desk_1',
      'work_desk_2',
      'work_desk_3',
      'work_desk_4',
      'work_desk_5',
      'work_desk_6',
      'work_desk_7',
      'meeting_room',
      'review_area',
    ];
    if (updateDto.room && !validRooms.includes(updateDto.room)) {
      throw new BadRequestException(`Invalid room: ${updateDto.room}`);
    }

    // Update agent fields
    if (updateDto.position_x !== undefined) agent.position_x = updateDto.position_x;
    if (updateDto.position_y !== undefined) agent.position_y = updateDto.position_y;
    if (updateDto.room !== undefined) agent.room = updateDto.room;
    if (updateDto.status !== undefined) agent.status = updateDto.status;

    agent.updated_at = new Date();

    // Save to database (concurrent-safe via TypeORM transaction)
    const updatedAgent = await this.agentRepository.save(agent);

    // Update Redis cache
    await this.redis.hset(
      `hvo:agent:${id}`,
      'position_x',
      updatedAgent.position_x,
      'position_y',
      updatedAgent.position_y,
      'room',
      updatedAgent.room,
      'status',
      updatedAgent.status,
    );

    this.logger.log(
      `Agent ${id} updated: position=(${updatedAgent.position_x}, ${updatedAgent.position_y}), status=${updatedAgent.status}`,
    );

    return updatedAgent;
  }

  /**
   * Assign task to agent
   * Updates current_task_id and status=working
   */
  async assignTask(agentId: string, taskId: string): Promise<Agent> {
    const agent = await this.getAgent(agentId);

    agent.current_task_id = taskId;
    agent.status = 'working';
    agent.room = 'work_desk_1'; // Auto-move to work desk
    agent.updated_at = new Date();

    const updatedAgent = await this.agentRepository.save(agent);

    // Update Redis
    await this.redis.hset(
      `hvo:agent:${agentId}`,
      'current_task_id',
      taskId,
      'status',
      'working',
      'room',
      'work_desk_1',
    );

    this.logger.log(`Task ${taskId} assigned to agent ${agentId}`);

    return updatedAgent;
  }

  /**
   * Release task from agent
   * Updates current_task_id=null and status=idle, room=lobby
   */
  async releaseTask(agentId: string): Promise<Agent> {
    const agent = await this.getAgent(agentId);

    agent.current_task_id = undefined;
    agent.status = 'idle';
    agent.room = 'lobby';
    agent.updated_at = new Date();

    const updatedAgent = await this.agentRepository.save(agent);

    // Update Redis
    await this.redis.hset(
      `hvo:agent:${agentId}`,
      'current_task_id',
      '',
      'status',
      'idle',
      'room',
      'lobby',
    );

    this.logger.log(`Agent ${agentId} released from task`);

    return updatedAgent;
  }

  /**
   * Get agents by status (e.g., all idle agents for task assignment)
   */
  async getAgentsByStatus(status: AgentStatus): Promise<Agent[]> {
    return this.agentRepository.find({
      where: { status },
      order: { created_at: 'ASC' },
    });
  }

  /**
   * Get agent position from Redis (fast cache lookup)
   */
  async getAgentPositionFromCache(agentId: string): Promise<Record<string, any> | null> {
    const data = await this.redis.hgetall(`hvo:agent:${agentId}`);
    return Object.keys(data).length > 0 ? data : null;
  }

  /**
   * Update agent status only (for heartbeat/monitoring)
   * Used by HeartbeatMonitoringService to update online/offline status
   */
  async updateAgentStatus(agentId: string, status: 'online' | 'offline' | 'idle' | 'working'): Promise<Agent> {
    const agent = await this.getAgent(agentId);

    // Map heartbeat status to agent status enum
    let agentStatus: AgentStatus;
    if (status === 'online') {
      agentStatus = 'idle'; // online → idle
    } else if (status === 'offline') {
      agentStatus = 'blocked'; // offline → blocked
    } else if (status === 'idle' || status === 'working') {
      agentStatus = status as AgentStatus;
    } else {
      agentStatus = 'idle';
    }

    agent.status = agentStatus;
    agent.updated_at = new Date();

    const updatedAgent = await this.agentRepository.save(agent);

    // Update Redis cache
    await this.redis.hset(`hvo:agent:${agentId}`, 'status', agentStatus);

    this.logger.log(`Agent ${agentId} status updated to ${agentStatus} (from ${status})`);

    return updatedAgent;
  }

  /**
   * Cleanup Redis connection
   */
  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
