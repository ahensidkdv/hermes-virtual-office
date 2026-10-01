/**
 * Type definitions for Hermes Virtual Office
 */

export type AgentStatus = 'idle' | 'working' | 'discussing' | 'blocked';
export type RoomType = 'lobby' | 'work_desk_1' | 'work_desk_2' | 'work_desk_3' | 'work_desk_4' | 'work_desk_5' | 'work_desk_6' | 'work_desk_7' | 'meeting_room' | 'review_area';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Agent {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  position_x: number;
  position_y: number;
  room: RoomType;
  current_task_id: string | null;
  hermes_id: string | null;
  capabilities: string[];
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  priority: TaskPriority;
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed';
  assigned_agent_id?: string;
  subtasks?: Task[];
  created_at: string;
  updated_at: string;
}

export interface WebSocketEvent {
  type: string;
  timestamp: string;
  [key: string]: any;
}

export interface AgentMoveEvent extends WebSocketEvent {
  type: 'agent:move';
  agentId: string;
  position_x: number;
  position_y: number;
  room: RoomType;
}

export interface AgentStatusEvent extends WebSocketEvent {
  type: 'agent:status';
  agentId: string;
  status: AgentStatus;
}

export interface TaskAssignedEvent extends WebSocketEvent {
  type: 'task:assigned';
  taskId: string;
  agentId: string;
  subtaskCount: number;
}

export interface Office {
  agents: Agent[];
  tasks: Task[];
  activeTaskCount: number;
  activeAgentCount: number;
}
