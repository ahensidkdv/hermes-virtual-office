import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  BadRequestException,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { AgentsService } from './agents.service';
import { UpdateAgentPositionDto } from './dto/agent.dto';
import { Agent } from '../entities/agent.entity';

/**
 * Agents Controller - REST API endpoints for agent management
 * Endpoints:
 *   GET /api/agents - List all agents
 *   GET /api/agents/:id - Get agent detail + current task
 *   PATCH /api/agents/:id - Update position + status
 */
@Controller('api/agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  /**
   * GET /api/agents
   * List all mock agents (5 seeded on startup)
   */
  @Get()
  async listAgents(): Promise<{
    agents: Agent[];
    count: number;
  }> {
    const agents = await this.agentsService.listAgents();
    return {
      agents,
      count: agents.length,
    };
  }

  /**
   * GET /api/agents/:id
   * Get agent detail with current task and status
   */
  @Get(':id')
  async getAgent(@Param('id') id: string): Promise<Agent> {
    return this.agentsService.getAgent(id);
  }

  /**
   * PATCH /api/agents/:id
   * Update agent position (x, y, room) and/or status
   * Validation: status enum, room enum
   * Concurrent-safe: TypeORM handles race conditions
   */
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async updateAgent(
    @Param('id') id: string,
    @Body() updateDto: UpdateAgentPositionDto,
  ): Promise<Agent> {
    return this.agentsService.updateAgent(id, updateDto);
  }
}
