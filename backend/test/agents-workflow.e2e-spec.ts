import { INestApplication, ValidationPipe, BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as request from 'supertest';
import { AppModule } from '../app.module';
import { Task } from '../entities/task.entity';
import { Agent } from '../entities/agent.entity';

describe('Agent Assignment E2E Workflow (e2e)', () => {
  let app: INestApplication;
  let testingModule: TestingModule;

  beforeAll(async () => {
    testingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = testingModule.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Full Agent Assignment Workflow', () => {
    let taskId: string;
    let agentId: string;

    it('should list all seeded agents', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/agents')
        .expect(200);

      expect(response.body).toHaveProperty('agents');
      expect(response.body).toHaveProperty('count');
      expect(response.body.count).toBeGreaterThanOrEqual(5);
      expect(response.body.agents.length).toBeGreaterThanOrEqual(5);

      agentId = response.body.agents[0].id;
    });

    it('should get agent detail', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/agents/${agentId}`)
        .expect(200);

      expect(response.body).toHaveProperty('id', agentId);
      expect(response.body).toHaveProperty('name');
      expect(response.body).toHaveProperty('status', 'idle');
      expect(response.body).toHaveProperty('room', 'lobby');
    });

    it('should create a new task', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/tasks')
        .send({
          title: 'Implement authentication system for user management',
          description: 'Add JWT authentication and role-based access control',
          priority: 'high',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('status', 'created');
      expect(response.body.title).toContain('authentication');

      taskId = response.body.id;
    });

    it('should update agent position and status', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/agents/${agentId}`)
        .send({
          position_x: 200,
          position_y: 150,
          room: 'work_desk_1',
          status: 'working',
        })
        .expect(200);

      expect(response.body.position_x).toBe(200);
      expect(response.body.position_y).toBe(150);
      expect(response.body.room).toBe('work_desk_1');
      expect(response.body.status).toBe('working');
    });

    it('should return 404 when agent not found', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/agents/non-existent-agent')
        .expect(404);

      expect(response.body).toHaveProperty('message');
    });

    it('should return 400 when invalid status provided', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/agents/${agentId}`)
        .send({
          status: 'invalid_status',
        })
        .expect(400);

      expect(response.body).toHaveProperty('message');
    });

    it('should return 400 when invalid room provided', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/agents/${agentId}`)
        .send({
          room: 'invalid_room',
        })
        .expect(400);

      expect(response.body).toHaveProperty('message');
    });

    it('should list all agents with proper structure', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/agents')
        .expect(200);

      const agent = response.body.agents[0];
      expect(agent).toHaveProperty('id');
      expect(agent).toHaveProperty('name');
      expect(agent).toHaveProperty('role');
      expect(agent).toHaveProperty('status');
      expect(agent).toHaveProperty('position_x');
      expect(agent).toHaveProperty('position_y');
      expect(agent).toHaveProperty('room');
      expect(agent).toHaveProperty('current_task_id');
    });

    it('should verify agent position persists after update', async () => {
      // First update
      await request(app.getHttpServer())
        .patch(`/api/agents/${agentId}`)
        .send({
          position_x: 300,
          position_y: 250,
        })
        .expect(200);

      // Verify persistence
      const response = await request(app.getHttpServer())
        .get(`/api/agents/${agentId}`)
        .expect(200);

      expect(response.body.position_x).toBe(300);
      expect(response.body.position_y).toBe(250);
    });
  });

  describe('Concurrent Agent Updates (Race Condition Handling)', () => {
    let agentId: string;

    beforeAll(async () => {
      const response = await request(app.getHttpServer())
        .get('/api/agents')
        .expect(200);

      agentId = response.body.agents[1].id; // Use different agent
    });

    it('should handle concurrent PATCH requests safely', async () => {
      const updates = Array.from({ length: 5 }, (_, i) => ({
        position_x: 100 + i * 50,
        position_y: 100 + i * 50,
      }));

      // Send concurrent requests
      const responses = await Promise.all(
        updates.map((update) =>
          request(app.getHttpServer())
            .patch(`/api/agents/${agentId}`)
            .send(update),
        ),
      );

      // All should succeed
      responses.forEach((response) => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('position_x');
        expect(response.body).toHaveProperty('position_y');
      });
    });
  });
});
