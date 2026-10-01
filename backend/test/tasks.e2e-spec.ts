import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, BadRequestException } from '@nestjs/common';
import * as request from 'supertest';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from '../src/entities/task.entity';
import { TasksModule } from '../src/tasks/tasks.module';
import { AgentsModule } from '../src/agents/agents.module';
import { HealthController } from '../src/health.controller';

describe('Tasks E2E (US-TM-01 & US-TM-02)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: process.env.DB_HOST || 'localhost',
          port: parseInt(process.env.DB_PORT || '5432', 10),
          username: process.env.DB_USER || 'postgres',
          password: process.env.DB_PASSWORD || 'postgres',
          database: process.env.DB_NAME_TEST || 'hvo_test',
          entities: [Task],
          synchronize: true, // For E2E tests
          dropSchema: true,
        }),
        TasksModule,
        AgentsModule,
      ],
      controllers: [HealthController],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: (errors) => {
          const messages = errors.map(error => ({
            field: error.property,
            message: Object.values(error.constraints || {}).join(', '),
          }));
          return new BadRequestException({
            statusCode: 400,
            message: 'Validation failed',
            errors: messages,
          });
        },
      }),
    );

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('US-TM-01: Task Input via Operator Interface', () => {
    describe('POST /api/tasks', () => {
      it('should create task with valid input', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/tasks')
          .send({
            title: 'Conduct comprehensive market research',
            priority: 'high',
            description: 'Research market trends and competitors',
          })
          .expect(201);

        expect(response.body).toHaveProperty('id');
        expect(response.body.title).toBe('Conduct comprehensive market research');
        expect(response.body.status).toBe('created');
        expect(response.body.priority).toBe('high');
        expect(response.body.message).toBe('Task created successfully');
      });

      it('should reject task with title < 10 characters', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/tasks')
          .send({
            title: 'Short',
            priority: 'medium',
          })
          .expect(400);

        expect(response.body.message).toContain('Validation failed');
      });

      it('should reject task with empty title', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/tasks')
          .send({
            title: '   ',
            priority: 'medium',
          })
          .expect(400);

        expect(response.body.message).toContain('Validation failed');
      });

      it('should reject task with missing title', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/tasks')
          .send({
            priority: 'medium',
          })
          .expect(400);

        expect(response.body.message).toContain('Validation failed');
      });

      it('should reject task with invalid priority', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/tasks')
          .send({
            title: 'Conduct comprehensive market research',
            priority: 'invalid',
          })
          .expect(400);

        expect(response.body.message).toContain('Validation failed');
      });

      it('should default priority to medium', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/tasks')
          .send({
            title: 'Conduct comprehensive market research',
          })
          .expect(201);

        expect(response.body.priority).toBe('medium');
      });
    });

    describe('GET /api/tasks/:id', () => {
      let taskId: string;

      beforeAll(async () => {
        const response = await request(app.getHttpServer())
          .post('/api/tasks')
          .send({
            title: 'Conduct comprehensive market research',
            priority: 'high',
          });

        taskId = response.body.id;
      });

      it('should retrieve task by ID', async () => {
        const response = await request(app.getHttpServer())
          .get(`/api/tasks/${taskId}`)
          .expect(200);

        expect(response.body.id).toBe(taskId);
        expect(response.body.title).toBe('Conduct comprehensive market research');
        expect(response.body.status).toBe('created');
      });

      it('should return 404 for non-existent task', async () => {
        await request(app.getHttpServer())
          .get('/api/tasks/00000000-0000-0000-0000-000000000000')
          .expect(404);
      });
    });

    describe('GET /api/tasks', () => {
      it('should list all root tasks', async () => {
        const response = await request(app.getHttpServer())
          .get('/api/tasks')
          .expect(200);

        expect(Array.isArray(response.body.tasks)).toBe(true);
        expect(response.body.count).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('US-TM-02: Task Decomposition by Mock Manager Agent', () => {
    describe('Task decomposition workflow', () => {
      let parentTaskId: string;

      beforeAll(async () => {
        const response = await request(app.getHttpServer())
          .post('/api/tasks')
          .send({
            title: 'Conduct comprehensive market research',
            priority: 'high',
          });

        parentTaskId = response.body.id;

        // Wait for mock manager agent to process task.created event
        await new Promise(resolve => setTimeout(resolve, 2000));
      });

      it('should decompose task into subtasks', async () => {
        const response = await request(app.getHttpServer())
          .get(`/api/tasks/${parentTaskId}/subtasks`)
          .expect(200);

        expect(response.body.parent_task_id).toBe(parentTaskId);
        expect(Array.isArray(response.body.subtasks)).toBe(true);
        expect(response.body.count).toBeGreaterThanOrEqual(2); // At least 2 subtasks
        expect(response.body.count).toBeLessThanOrEqual(4); // At most 4 subtasks
      });

      it('should update parent task status to assigned', async () => {
        // Wait for manager agent to update status
        await new Promise(resolve => setTimeout(resolve, 1000));

        const response = await request(app.getHttpServer())
          .get(`/api/tasks/${parentTaskId}`)
          .expect(200);

        expect(response.body.status).toBe('assigned');
      });

      it('should have subtasks with parent_task_id reference', async () => {
        const response = await request(app.getHttpServer())
          .get(`/api/tasks/${parentTaskId}/subtasks`)
          .expect(200);

        expect(response.body.subtasks.length).toBeGreaterThan(0);
        response.body.subtasks.forEach((subtask: Task) => {
          expect(subtask.parent_task_id).toBe(parentTaskId);
          expect(subtask.status).toBe('created');
        });
      });
    });

    describe('Concurrent task creation', () => {
      it('should handle multiple concurrent task creations', async () => {
        const promises = [];

        for (let i = 0; i < 3; i++) {
          promises.push(
            request(app.getHttpServer())
              .post('/api/tasks')
              .send({
                title: `Concurrent task number ${i + 1} with detailed description`,
                priority: 'medium',
              }),
          );
        }

        const results = await Promise.all(promises);

        results.forEach(response => {
          expect(response.status).toBe(201);
          expect(response.body.id).toBeDefined();
          expect(response.body.status).toBe('created');
        });

        expect(results[0].body.id).not.toBe(results[1].body.id);
        expect(results[1].body.id).not.toBe(results[2].body.id);
      });
    });
  });

  describe('Health Check', () => {
    it('GET /health should return status ok', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.timestamp).toBeDefined();
    });
  });
});
