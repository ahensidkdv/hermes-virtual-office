# ROADMAP

## Phase 0: Infrastructure (Sprint 1: Oct 1-15) ✅ IN PROGRESS

**Goal:** Working Docker stack + API skeleton

- [x] Repository initialization
- [x] Docker Compose setup (Postgres, Redis, containers)
- [x] PostgreSQL schema + migrations
- [x] NestJS backend skeleton
- [x] Health endpoints
- [ ] Mock Hermes adapter
- [ ] Basic API CRUD (agents, tasks)
- [ ] WebSocket gateway setup
- [ ] React frontend skeleton
- [ ] E2E test harness

**Success Criteria:**
- `docker compose up -d` → all healthy in < 30s
- `GET /api/agents` → returns mock agent list
- `POST /api/tasks` → creates task + publishes event
- Frontend builds without errors

---

## Phase 1: Core Loop (Sprint 2: Oct 15-29)

**Goal:** 2D visualization + task input → agent assignment

- [ ] PixiJS fixed 2D map renderer (4 rooms)
- [ ] Avatar sprite + status badges
- [ ] Real-time avatar position updates (WebSocket)
- [ ] Task input form (UI)
- [ ] Agent detail panel (drill-down)
- [ ] Mock agent lifecycle (Lobby → Work → Review → Done)
- [ ] Activity feed (basic log viewer)
- [ ] Dashboard metrics (# agents, # tasks, uptime)

**Success Criteria:**
- User creates task → manager agent appears → assigns to work desk
- Avatar moves smoothly (< 500ms latency)
- Panel shows current task + logs
- 2D map renders in < 3 seconds

---

## Phase 2: Real Integration & Collaboration (Sprint 3-4: Oct 29-Nov 26)

**Goal:** Real Hermes adapter + shared memory sync

- [ ] Hermes adapter implementation (replace mock)
- [ ] Agent heartbeat monitoring
- [ ] Shared memory write/read (task-scoped Redis keys)
- [ ] Conflict resolution (optimistic locking)
- [ ] Meeting room logic (2+ agents discuss)
- [ ] Memory indicator (float icon over avatar)
- [ ] E2E test: task → decompose → assign → shared memory sync

**Success Criteria:**
- Real Hermes agents execute tasks
- 2+ agents write to same shared key without data loss
- Meeting room shows agent interaction
- Audit trail captures all memory operations

---

## Phase 3: Human-in-the-Loop (Sprint 5: Nov 26-Dec 10)

**Goal:** Operator control + approval gates

- [ ] Pause/Resume task execution
- [ ] Cancel task workflow
- [ ] Manual context injection (operator sends message)
- [ ] Review/Approval gate (agent → Review Area → operator approves)
- [ ] Rejection + feedback loop
- [ ] Alert system (agent stuck/error/timeout)
- [ ] Watchdog monitoring (detect deadlocks)

**Success Criteria:**
- Operator pauses task → agent stops mid-execution
- Operator injects context → agent incorporates in next step
- Operator rejects output → agent retries with feedback
- Timeout alert triggers if agent stalled > 120s

---

## Phase 4: Monitoring & Polish (Sprint 6+: Dec 10+)

**Goal:** Operational excellence + hardening

- [ ] Advanced monitoring dashboard
- [ ] Retry logic & exponential backoff
- [ ] Rate limiting & quotas
- [ ] Data encryption at rest (pgcrypto)
- [ ] Security audit (OWASP compliance)
- [ ] Performance benchmarking
- [ ] Documentation (API, architecture, ops)
- [ ] Dark mode / accessibility
- [ ] Mobile-responsive view (read-only)

**Success Criteria:**
- < 5% error rate over 1 week
- < 1 second p95 latency
- All OWASP Top 10 mitigated
- Zero unhandled exceptions

---

## Phase 5+: Nice-to-Have Features (v2+)

- **Direct chat** with agent
- **Replay mode** (time-travel office state)
- **Custom office layout** editor
- **Analytics** (token usage, cost, time per phase)
- **Workflow templates** (preset decomposition)
- **Multi-user collaboration** (multiple operators)
- **3D/VR office** view
- **Gamification** (streaks, badges, leaderboard)

---

## Dependency Map

```
Phase 0 (Infra)
    ↓
Phase 1 (Core Loop)
    ↓
Phase 2 (Real Hermes + Memory)
    ├─→ Phase 3 (HITL)
    │       ↓
    │   Phase 4 (Monitoring)
    │
    └─→ Phase 5+ (Nice-to-have)
```

**Critical Path:** 0 → 1 → 2 → 3 → 4

---

## Current Status

- **Phase:** 0 (Infrastructure)
- **Sprint:** 1 / 6
- **Team:** 1 developer (fajargum)
- **Next Review:** Sprint 1 completion (2026-10-15)

---

## Known Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|-----------|
| Hermes API instability | High | Mock adapter + Phase 3 transition testing |
| Real-time perf (7 agents) | Medium | Throttle updates, batch broadcasts |
| Shared memory conflicts | Medium | Optimistic locking + audit trail |
| Scope creep on UI | High | Lock MVP to 2D fixed layout (no custom editor) |
| Single dev burnout | Medium | Clear sprint boundaries, async retros |

---

**Last Updated:** 2026-10-01  
**Maintained By:** @fajargumelar
