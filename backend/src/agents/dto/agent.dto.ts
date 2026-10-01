import { IsString, IsNumber, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AgentStatus, AgentRoom } from '../../entities/agent.entity';

export class UpdateAgentPositionDto {
  @IsNumber()
  @IsOptional()
  position_x?: number;

  @IsNumber()
  @IsOptional()
  position_y?: number;

  @IsEnum([
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
  ])
  @IsOptional()
  room?: AgentRoom;

  @IsEnum(['idle', 'working', 'discussing', 'blocked'])
  @IsOptional()
  status?: AgentStatus;
}

export class UpdateAgentStatusDto {
  @IsEnum(['idle', 'working', 'discussing', 'blocked'])
  status!: AgentStatus;
}

export class CreateAgentDto {
  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  role?: string;

  @IsEnum(['idle', 'working', 'discussing', 'blocked'])
  @IsOptional()
  status?: AgentStatus;

  @IsNumber()
  @IsOptional()
  position_x?: number;

  @IsNumber()
  @IsOptional()
  position_y?: number;

  @IsEnum([
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
  ])
  @IsOptional()
  room?: AgentRoom;

  @IsUUID()
  @IsOptional()
  current_task_id?: string;

  @IsString()
  @IsOptional()
  hermes_id?: string;

  @IsOptional()
  capabilities?: string[];
}
