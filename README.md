# Hermes Virtual Office (HVO)

**Real-time visualization & coordination system for autonomous AI agents managed by Hermes.**

A browser-based virtual office where agents execute tasks, collaborate via shared memory, and interact with human operators through a 2D canvas interface.

## 🎯 Quick Start

### Prerequisites
- Docker & Docker Compose 2.0+
- Node.js 18+ (for local development)
- Git

### Run Stack (Docker)
```bash
git clone https://github.com/fajargumelar/hermes-virtual-office.git
cd hermes-virtual-office

cp .env.example .env
# Edit .env with your values (optional for local dev)

docker compose up -d
```

Health check:
```bash
curl http://localhost:3001/health     # Backend
curl http://localhost:3000            # Frontend (coming in Phase 2)
docker compose ps                     # See all services
```

### Seed Mock Data
```bash
docker compose exec backend npm run seed:agents
```

## 📋 Architecture

- **Frontend:** React + PixiJS 8 + Zustand (Phase 2+)
- **Backend:** NestJS + TypeORM + PostgreSQL
- **Realtime:** WebSocket (Socket.IO) + Redis Pub/Sub
- **Deployment:** Docker Compose (local), K8s later

## 📚 Documentation

- [Architecture Decision Records](./docs/ADR.md) — tech choices rationale
- [Setup Guide](./docs/SETUP.md) — detailed installation
- [API Reference](./docs/API.md) — endpoint documentation
- [Contributing](./docs/CONTRIBUTING.md) — dev workflow

## 🚀 Development

### Current Phase
**Phase 0 (Sprint 1):** Infrastructure setup
- Docker compose stack ✅
- PostgreSQL schema + TypeORM
- Basic API skeleton (agents, tasks, shared-memory)
- WebSocket gateway
- Mock Hermes adapter

### Roadmap
- **Phase 1 (Sprint 2):** Core loop (2D map, avatar movement, task input)
- **Phase 2 (Sprint 3-4):** Real Hermes integration + shared memory
- **Phase 3 (Sprint 5):** Human-in-the-loop (pause/resume, inject, approve)
- **Phase 4+ (Sprint 6+):** Monitoring, polish, hardening

### Sprint Cadence
- Monday 10:00 WIB: Planning + standup
- Friday 16:00 WIB: Demo + retro
- Async: GitHub issues, PRs via Discord

## 📊 Project Board

- [GitHub Project: Sprint 1 Tasks](https://github.com/fajargumelar/hermes-virtual-office/projects)
- Issues: [user-stories](https://github.com/fajargumelar/hermes-virtual-office/issues?q=label%3Auser-story), [bugs](https://github.com/fajargumelar/hermes-virtual-office/issues?q=label%3Abug)

## 🔐 Security

- **Encryption at Rest:** pgcrypto (PostgreSQL)
- **Encryption in Transit:** TLS 1.3
- **Secrets:** `.env` file (gitignored, use `.env.example` template)

## 📝 License

MIT License — see [LICENSE](./LICENSE)

---

**Author:** [@fajargumelar](https://github.com/fajargumelar)  
**Status:** Active Development (Sprint 1)
