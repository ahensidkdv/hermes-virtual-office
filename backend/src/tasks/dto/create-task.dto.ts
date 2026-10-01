import { IsString, IsEnum, MinLength, IsNotEmpty, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export class CreateTaskDto {
  @IsString()
  @IsNotEmpty({ message: 'Title is required and cannot be empty' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(10, { message: 'Title must be at least 10 characters long' })
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(['low', 'medium', 'high', 'critical'], {
    message: 'Priority must be one of: low, medium, high, critical',
  })
  priority?: TaskPriority = 'medium';
}

export class UpdateTaskStatusDto {
  @IsEnum(['created', 'assigned', 'in_progress', 'review', 'done'], {
    message: 'Status must be one of: created, assigned, in_progress, review, done',
  })
  status!: string;
}
