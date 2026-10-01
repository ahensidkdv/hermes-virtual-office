# HVO Backend

NestJS + TypeORM + PostgreSQL + Redis backend for Hermes Virtual Office (HVO).

## Project Structure

```
backend/
├── src/
│   ├── database/
│   │   ├── data-source.ts
│   │   └── migrations/
│   ├── entities/
│   │   └── task.entity.ts
│   ├── tasks/
│   │   ├── dto/
│   │   ├── tasks.controller.ts
│   │   ├── tasks.service.ts
│   │   ├── tasks.service.spec.ts
│   │   └── tasks.module.ts
│   ├── agents/
│   │   ├── mock-manager-agent.service.ts
│   │   └── agents.module.ts
│   ├── events/
│   │   └── cloud-event.service.ts
│   ├── app.module.ts
│   ├── main.ts
│   └── health.controller.ts
├── test/
│   ├── tasks.e2e-spec.ts
│   └── jest-e2e.json
├── package.json
├── tsconfig.json
├── jest.config.js
└── Dockerfile
```

## Setup

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- PostgreSQL 16 (via docker-compose)
- Redis 7 (via docker-compose)

### Installation

```bash
cd backend
npm install
```

### Environment Variables

Copy `.env.development` and configure as needed:

```bash
cp .env.development .env
```

### Database Migrations

```bash
# Run migrations
npm run migrate

# Revert last migration
npm run migrate:revert

# Generate migration from entity changes
npm run migration:generate -- src/database/migrations/YourMigrationName
```

### Running the Backend

**Development:**
```bash
npm run start:dev
```

**Production:**
```bash
npm run build
npm run start:prod
```

### Testing

**Unit tests:**
```bash
npm test
npm test -- --coverage
```

**E2E tests:**
```bash
npm run test:e2e
```

## API Endpoints

### Tasks

- **POST /api/tasks** - Create a new task
  ```bash
  curl -X POST http://localhost:3001/api/tasks \
    -H "Content-Type: application/json" \
    -d '{
      "title": "Conduct comprehensive market research",
      "priority": "high",
      "description": "Research market trends"
    }'
  ```

- **GET /api/tasks** - List all root-level tasks
  ```bash
  curl http://localhost:3001/api/tasks
  ```

- **GET /api/tasks/:id** - Get a specific task with subtasks
  ```bash
  curl http://localhost:3001/api/tasks/{id}
  ```

- **GET /api/tasks/:id/subtasks** - Get subtasks for a task
  ```bash
  curl http://localhost:3001/api/tasks/{id}/subtasks
  ```

- **POST /api/tasks/:id/status** - Update task status
  ```bash
  curl -X POST http://localhost:3001/api/tasks/{id}/status \
    -H "Content-Type: application/json" \
    -d '{"status": "assigned"}'
  ```

### Health

- **GET /health** - Health check
  ```bash
  curl http://localhost:3001/health
  ```

## Architecture

### Task Lifecycle

```
created → assigned → in_progress → review → done
```

### CloudEvents

All domain events are published in CloudEvents format (v1.0) to Redis Pub/Sub channel `hvo:events`:

**Task Created Event:**
```json
{
  "specversion": "1.0",
  "type": "hvo.task.created",
  "source": "hvo/tasks-service",
  "id": "550e8400-e29b-41d4-a716-446655440000-1696138400000",
  "time": "2026-10-01T10:30:00Z",
  "datacontenttype": "application/json",
  "data": {
    "task_id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "Conduct comprehensive market research",
    "priority": "high",
    "description": "Research market trends",
    "created_at": "2026-10-01T10:30:00Z"
  }
}
```

### Mock Manager Agent

- Subscribes to `task.created` CloudEvents
- Decomposes task into 2-4 subtasks
- Updates parent task status: `created` → `assigned`
- Respects max 7 concurrent agents (queues remaining)
- Publishes `task.assigned` event on completion

## Testing Strategy

### Unit Tests
- Service layer: CRUD, state machine, error handling
- Mock database and CloudEvent service
- Aim for 100% coverage on business logic

### E2E Tests
- Full workflow: task creation → decomposition → status updates
- Uses real PostgreSQL and Redis (docker-compose)
- Validates CloudEvents published to Redis

## Known Limitations (Phase 0)

- Mock Manager Agent is in-memory (no real Hermes integration)
- No authentication/authorization (Phase 3)
- No shared memory (Phase 2)
- No rate limiting or quotas (Phase 4)

## Next Steps (Phase 1-2)

1. **Phase 1 (Sprint 2):** Real-time WebSocket updates, UI task input form
2. **Phase 2 (Sprint 3-4):** Real Hermes integration, shared memory sync
3. **Phase 3 (Sprint 5):** HITL controls, approval gates, monitoring

## References

- [ADR-001: Mock-First Strategy](../docs/ADR.md)
- [ADR-006: NestJS + TypeORM](../docs/ADR.md)
- [ROADMAP.md](../ROADMAP.md)
