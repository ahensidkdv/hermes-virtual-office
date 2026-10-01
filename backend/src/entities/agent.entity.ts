import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Task } from './task.entity';

export type AgentStatus = 'idle' | 'working' | 'discussing' | 'blocked';
export type AgentRoom =
  | 'lobby'
  | 'work_desk_1'
  | 'work_desk_2'
  | 'work_desk_3'
  | 'work_desk_4'
  | 'work_desk_5'
  | 'work_desk_6'
  | 'work_desk_7'
  | 'meeting_room'
  | 'review_area';

/**
 * Agent entity representing an autonomous AI agent in HVO
 * Tracks position (x, y, room), status, and assigned task
 * Support for mock agents (Phase 0-1) → Real Hermes integration (Phase 2+)
 */
@Entity('agents')
@Index(['status'])
@Index(['current_task_id'])
@Index(['created_at'])
export class Agent {
  @PrimaryColumn('uuid')
  id: string = uuidv4();

  @Column('varchar', { length: 100 })
  name!: string;

  @Column('varchar', { length: 50, nullable: true })
  role?: string; // e.g., 'researcher', 'engineer', 'reviewer'

  @Column('varchar', { length: 50, default: 'idle' })
  status: AgentStatus = 'idle';

  @Column('float', { default: 100 })
  position_x: number = 100;

  @Column('float', { default: 100 })
  position_y: number = 100;

  @Column('varchar', { length: 50, default: 'lobby' })
  room: AgentRoom = 'lobby';

  @Column('uuid', { nullable: true })
  current_task_id?: string;

  @Column('varchar', { length: 100, nullable: true })
  hermes_id?: string; // Reference to real Hermes agent (Phase 2+)

  @Column('text', { array: true, default: () => `'{}'` })
  capabilities?: string[]; // e.g., ['research', 'coding', 'review']

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  // Relations
  @ManyToOne(() => Task, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'current_task_id' })
  current_task?: Task;
}
