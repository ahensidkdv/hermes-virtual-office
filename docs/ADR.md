# Architecture Decision Records (ADR)

## ADR-001: Hermes Integration Strategy

**Decision:** Mock-First → Real Later (Adapter Pattern)

**Context:**
- Hermes runtime API not yet stable/documented
- UI/backend development blocked without agent backend
- Need parallel development path

**Chosen Alternative:** Hybrid approach
- Phase 1-2 (Week 1-4): Mock in-memory adapter + simulation
- Phase 3+ (Week 5+): Real Hermes runtime via adapter interface

**Rationale:**
- ✅ Unblock frontend/backend development
- ✅ Adapter pattern isolates changes to Hermes API
- ✅ Can validate lifecycle independently of Hermes
- ❌ Mock maintenance overhead (acceptable for MVP)

**Consequences:**
- Mock agent behavior must be realistic (deadlines, logs, failures)
- Adapter interface must be stable (document early)
- Phase 3 transition requires adapter implementation testing

---

## ADR-002: Visualization Framework

**Decision:** PixiJS 8.x (over Phaser 3)

**Context:**
- Need 2D sprite rendering for 7 agents + 4 rooms
- Want React integration
- Bundle size matters (real-time UX critical)

**Chosen Alternative:** PixiJS 8
- Bundle: 200 KB (minified)
- Pairs well with React (just a renderer, not framework)
- Animation: Tween.js (5 KB additional)

**Alternatives Considered:**
- Phaser 3: 600 KB (400 KB overkill features), React friction
- Three.js: 150 KB but 3D complexity unnecessary
- Canvas API: Too low-level for rapid MVP

**Consequences:**
- Need custom input handling (not Phaser-provided)
- Animation system less feature-rich than Phaser (sufficient for v1)
- Upgrade path to Pixi Animate or Three.js if needed later

---

## ADR-003: Client State Management

**Decision:** Zustand (over Redux, Jotai)

**Context:**
- Small team (1-3 devs)
- Real-time updates critical (< 500ms latency)
- Rapid prototyping needed
- Complex domain logic deferred to Phase 3+

**Chosen Alternative:** Zustand
- Minimal boilerplate (60 lines vs Redux 400 lines)
- Built-in Immer (structural sharing)
- DevTools support via plugin
- 2 KB bundle size

**Alternatives Considered:**
- Redux: Excellent for large teams & complex workflows, overkill for MVP
- Jotai: Good atoms model, less intuitive for our domain

**Consequences:**
- Zustand usage patterns must be documented
- Clear upgrade path to Redux if team grows > 3 devs
- Revisit in Phase 3 if business logic complexity explodes

---

## ADR-004: Shared Memory Conflict Resolution

**Decision:** Optimistic Locking + Version Vector Clocks

**Context:**
- Multiple agents write to same task-scoped keys
- Race conditions expected (2+ agents accessing shared memory)
- Need audit trail for debugging

**Chosen Alternative:** Optimistic locking
- Agent reads version → writes new data + version+1
- Redis CAS (Compare-And-Swap) detects conflicts
- On conflict: auto-retry with backoff (max 3x)
- Escalate to human if conflict threshold exceeded

**Redis Data Model:**
```javascript
hvo:task:{taskId}:shared = {
  "research_summary": {
    value: {...},
    version: 2,
    written_by: "agent-01",
    written_at: "2026-10-01T10:30:00Z"
  }
}
```

**Alternatives Considered:**
- Last-write-wins: Simple but loses data (unacceptable)
- Pessimistic locking: Deadlock risk, slower
- CRDT (Conflict-free Replicated Data Types): Overkill for v1

**Consequences:**
- Agent logic must handle 409 CONFLICT responses
- Retry logic required (exponential backoff implementation)
- Audit trail every write (performance: +2-5ms per write)

---

## ADR-005: Development Phases & Sprint Structure

**Decision:** 2-week sprints, Waterfall-to-Agile hybrid

**Context:**
- Clear MVP scope (17 must-have user stories)
- Dependencies clear (UI blocks on backend API)
- Solo developer initially (fajargum)

**Chosen Alternative:** Phase-gated + 2-week sprints
- Phase 0: Infrastructure (Sprint 1)
- Phase 1: Core loop (Sprint 2)
- Phase 2: Real integration (Sprint 3-4)
- Phase 3: HITL controls (Sprint 5)
- Phase 4+: Polish/hardening (Sprint 6+)

**Sprint Cadence:**
- Monday 10:00 WIB: Planning + standup
- Friday 16:00 WIB: Demo + retro
- Async: PRs, issues via GitHub/Discord

**Consequences:**
- Clear milestone handoffs
- Phase 2 requires real Hermes runtime
- Must validate phase criteria before advancing

---

## ADR-006: Backend Framework & Ecosystem

**Decision:** Node.js + NestJS + TypeORM

**Context:**
- Real-time WebSocket critical (< 500ms latency)
- TypeScript for type safety
- Solo dev iteration speed important

**Chosen Alternative:** NestJS
- Built-in WebSocket/Socket.IO support
- Decorators reduce boilerplate
- TypeORM mature for PostgreSQL
- Strong ecosystem (Redis, validation, logging)

**Alternatives Considered:**
- FastAPI (Python): Simpler docs, but async/await patterns verbose
- Express.js: More flexible, less opinionated (too much scaffolding for solo dev)

**Consequences:**
- NestJS learning curve for Hermes integration
- TypeORM requires migration management
- Good debugging story (DevTools + logging middleware)

---

## ADR-007: Encryption & Security

**Decision:** pgcrypto (at-rest) + TLS 1.3 (in-transit)

**Context:**
- Data sensitive (task instructions, agent memory)
- Local deployment first (no cloud HSM)
- MVP simplicity required

**Chosen Alternative:** pgcrypto
- Built-in PostgreSQL encryption
- Column-level symmetric encryption (AES-256)
- Key rotation via app logic

**Alternatives Considered:**
- TDE (Transparent Data Encryption): PG extension, added complexity
- Vault (HashiCorp): Overkill for v1, added ops burden

**Consequences:**
- Encryption/decryption ~2-5ms per column
- Key management via `.env` (not ideal, revisit for prod)
- TLS everywhere (wss://, https://, AUTH on Redis)

---

## Decision Matrix (Summary)

| ADR | Decision | Confidence | Revisit |
|-----|----------|------------|---------|
| 001 | Mock adapter → Real Hermes | 95% | Phase 3 |
| 002 | PixiJS + Tween.js | 97% | Phase 4+ (animation polish) |
| 003 | Zustand | 96% | Phase 3+ (if team > 3 devs) |
| 004 | Optimistic locking | 92% | Phase 2 (after real integration) |
| 005 | 2-week sprints | 90% | Sprint 3 (adjust cadence) |
| 006 | NestJS + TypeORM | 94% | Never (stable choice) |
| 007 | pgcrypto + TLS | 85% | Phase 5+ (production hardening) |

---

**Last Updated:** 2026-10-01  
**Next Review:** Sprint 2 planning (2026-10-15)
