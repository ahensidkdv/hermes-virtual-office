import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

export type TaskStatus = 'created' | 'assigned' | 'in_progress' | 'review' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

/**
 * Task entity representing a unit of work in HVO
 * Supports parent-child relationships for task decomposition
 */
@Entity('tasks')
@Index(['status'])
@Index(['parent_task_id'])
@Index(['assigned_agent_id'])
@Index(['created_at'])
export class Task {
  @PrimaryColumn('uuid')
  id: string = uuidv4();

  @Column('varchar', { length: 255 })
  title!: string;

  @Column('text', { nullable: true })
  description?: string;

  @Column('varchar', { length: 50, default: 'created' })
  status: TaskStatus = 'created';

  @Column('varchar', { length: 20, nullable: true })
  priority?: TaskPriority;

  @Column('uuid', { nullable: true })
  parent_task_id?: string;

  @Column('uuid', { nullable: true })
  assigned_agent_id?: string;

  @Column('varchar', { length: 100, nullable: true })
  hermes_id?: string;

  @Column('jsonb', { default: () => `'{}'`, nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  @Column('timestamp', { nullable: true })
  completed_at?: Date;

  // Relations
  @ManyToOne(() => Task, task => task.subtasks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_task_id' })
  parent_task?: Task;

  @OneToMany(() => Task, task => task.parent_task)
  subtasks?: Task[];
}
