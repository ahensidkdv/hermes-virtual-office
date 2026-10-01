# Phase 2 Architecture: Real Hermes Integration + Shared Memory
**Version:** 1.0  
**Date:** 2026-10-01  
**Status:** DETAILED DESIGN  

---

## 📐 ARCHITECTURE OVERVIEW

Phase 2 introduces real-time integration with Hermes runtime, replacing the mock adapter. The architecture adds:
1. **Real Hermes Adapter** (task dispatch + event subscription)
2. **Heartbeat Monitoring** (agent online/offline detection)
3. **Shared Memory Service** (task-scoped Redis with optimistic locking)
4. **Conflict Resolution** (automatic retry + escalation)

---

## 🏗️ COMPONENT DIAGRAM

```
┌─────────────────────────────────────────────────────────────────┐
│                    HVO FRONTEND (React)                          │
│  ┌──────────────┐  ┌───────────────────┐  ┌─────────────────┐  │
│  │  2D Canvas   │  │ Status Badges     │  │ Memory Indicator│  │
│  │ (PixiJS)     │  │ (agent status)    │  │ (read/write)    │  │
│  └──────────────┘  └───────────────────┘  └─────────────────┘  │
└─────────────────────┬──────────────────────────────────────────┘
                      │ WebSocket
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                   HVO BACKEND (NestJS + Node.js)                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 🏢 API Layer                                             │  │
│  │  ┌────────────┐ ┌─────────────┐ ┌──────────────────┐   │  │
│  │  │ Agents API │ │ Tasks API   │ │ Memory API       │   │  │
│  │  │ (CRUD)     │ │ (dispatch)  │ │ (read/write)     │   │  │
│  │  └────────────┘ └─────────────┘ └──────────────────┘   │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 📡 WebSocket Gateway (OfficeGateway)                     │  │
│  │  ┌────────────────────────────────────────────────────┐ │  │
│  │  │ Events: agent:move, agent:status, task:assigned   │ │  │
│  │  │         memory:access, memory:conflict            │ │  │
│  │  └────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 🔗 Integration Layer                                     │  │
│  │  ┌───────────────────┐  ┌────────────────────────────┐  │  │
│  │  │ HermesAdapter     │  │ HeartbeatMonitoring       │  │  │
│  │  │ ├─ dispatchTask  │  │ ├─ subscribeHeartbeats    │  │  │
│  │  │ ├─ subscribeEvents  │ │ ├─ checkOfflineAgents   │  │  │
│  │  │ └─ sendSignal    │  │ └─ markAgentOffline      │  │  │
│  │  └───────────────────┘  └────────────────────────────┘  │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │ SharedMemoryService                               │  │  │
│  │  │ ├─ read(taskId, key)                            │  │  │
│  │  │ ├─ write(taskId, key, value, version)          │  │  │
│  │  │ ├─ detectConflict()                             │  │  │
│  │  │ └─ handleConflictResolution()                   │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 💾 Persistence Layer                                     │  │
│  │  ┌──────────────┐ ┌────────────┐ ┌────────────────────┐ │  │
│  │  │ PostgreSQL   │ │ Redis      │ │ Redis Pub/Sub      │ │  │
│  │  │ ├─ agents    │ │ ├─ memory  │ │ ├─ office:events   │ │  │
│  │  │ ├─ tasks     │ │ ├─ status  │ │ └─ hermes:events   │ │  │
│  │  │ ├─ audit     │ │ └─ heartb. │ └────────────────────┘ │  │
│  │  │ └─ memory_   │ │            │                         │  │
│  │  │   audit      │ │            │                         │  │
│  │  └──────────────┘ └────────────┘                         │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                      │ gRPC/REST
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    🤖 HERMES RUNTIME                             │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Task Execution                                           │  │
│  │ ├─ Dispatch → Queue → Execute → Complete               │  │
│  │ └─ Task Status Updates → Events                         │  │
│  ├─────────────────────────────────────────────────────────┤  │
│  │ Agent Management                                        │  │
│  │ ├─ Agent Registry (available agents + capabilities)    │  │
│  │ ├─ Heartbeat Stream (agent status)                     │  │
│  │ └─ Signal Handling (pause/resume/cancel)               │  │
│  ├─────────────────────────────────────────────────────────┤  │
│  │ Event Stream                                            │  │
│  │ ├─ task.queued / task.started / task.progress          │  │
│  │ ├─ task.completed / task.failed                        │  │
│  │ └─ agent.error / agent.offline / agent.online          │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📊 SEQUENCE DIAGRAM: Task Dispatch → Execution

```
Frontend          HVO Backend        Redis            PostgreSQL      Hermes
   │                  │               │                   │             │
   │ Create Task       │               │                   │             │
   │──────────────────>│               │                   │             │
   │                  │ Save Task       │                   │             │
   │                  │───────────────────────────────────>│             │
   │                  │                │                   │ OK          │
   │                  │<───────────────────────────────────│             │
   │                  │                │                   │             │
   │                  │ Dispatch       │                   │             │
   │                  │───────────────────────────────────────────────>│
   │                  │                │                   │        Accept
   │                  │                │                   │   hermes_id
   │                  │<───────────────────────────────────────────────│
   │                  │                │                   │             │
   │                  │ Store Mapping   │                   │             │
   │                  │ hvo_id->hermes_id                   │             │
   │                  │───────>│                            │             │
   │                  │        │ OK                         │             │
   │                  │<───────│                            │             │
   │                  │                │                   │             │
   │ Task Assigned    │                │                   │             │
   │<──────────────────                │                   │             │
   │                  │ Subscribe to Hermes Events          │             │
   │                  │───────────────────────────────────────────────>│
   │                  │                │                   │   Stream OK │
   │                  │<───────────────────────────────────────────────│
   │                  │                │                   │             │
   │ (Agent executes) │                │                   │   Events... │
   │                  │                │<──────────────────────────────│
   │                  │ Convert → CloudEvent                │             │
   │                  │                │                   │             │
   │                  │ Update Task Status                  │             │
   │                  │───────────────────────────────────>│             │
   │                  │                │                   │ OK          │
   │                  │<───────────────────────────────────│             │
   │                  │                │                   │             │
   │                  │ Publish to Redis Pub/Sub            │             │
   │                  │───────>│ Broadcast                  │             │
   │                  │        │                            │             │
   │<─────────────────────────────── office:events ────────│             │
   │ Task Progress    │                │                   │             │
   │                  │                │                   │             │
   │ (loop: events -> status -> broadcast -> frontend)    │             │
   │                  │                │                   │             │
   │ Task Complete    │                │                   │  Complete   │
   │                  │<───────────────────────────────────────────────│
   │<──────────────────                │                   │             │
```

---

## 🔄 SEQUENCE DIAGRAM: Shared Memory Conflict Resolution

```
Agent 1           Agent 2           SharedMemory       Redis           DB (Audit)
  │                 │                   │               │                │
  │ Read key        │                   │               │                │
  │──────────────────────────────────>│               │                │
  │                 │                   │ Get v0        │                │
  │                 │                   │───────────>│                │
  │ Return v0       │                   │<───────────│                │
  │<──────────────────────────────────│               │                │
  │                 │                   │               │                │
  │                 │ Read key          │               │                │
  │                 │──────────────────────────────>│               │
  │                 │                   │ Get v0        │                │
  │                 │                   │───────────>│                │
  │                 │ Return v0         │<───────────│                │
  │                 │<──────────────────────────────│               │
  │                 │                   │               │                │
  │ Write v0→v1     │                   │               │                │
  │──────────────────────────────────>│               │                │
  │                 │                   │ MULTI          │                │
  │                 │                   │ Check v==0     │                │
  │                 │                   │───────────>│                │
  │                 │                   │<───────────│ v==0? YES      │
  │                 │                   │ INCR v          │                │
  │                 │                   │ WRITE entry     │                │
  │                 │                   │ EXEC            │                │
  │                 │                   │───────────>│                │
  │ Return v1 ✅    │                   │<───────────│                │
  │<──────────────────────────────────│               │                │
  │                 │ Write v0→v1       │               │                │
  │                 │──────────────────────────────>│               │
  │                 │                   │ Check v==0?    │                │
  │                 │                   │───────────>│                │
  │                 │                   │<───────────│ v!=0 (v=1)     │
  │                 │ 409 CONFLICT ❌   │               │                │
  │                 │<──────────────────────────────│               │
  │                 │                   │               │ Log conflict   │
  │                 │                   │               │ ──────────────>│
  │                 │                   │               │                │
  │                 │ Read key (retry)  │               │                │
  │                 │──────────────────────────────>│               │
  │                 │                   │ Return v1      │                │
  │                 │                   │───────────>│                │
  │                 │ Return v1         │<───────────│                │
  │                 │<──────────────────────────────│               │
  │                 │                   │               │                │
  │                 │ Write v1→v2       │               │                │
  │                 │ (merge)           │               │                │
  │                 │──────────────────────────────>│               │
  │                 │                   │ Check v==1     │                │
  │                 │                   │───────────>│                │
  │                 │                   │<───────────│ v==1? YES      │
  │                 │ Return v2 ✅      │ INCR → v2      │                │
  │                 │<──────────────────────────────│               │
  │                 │                   │               │ Log retry OK   │
  │                 │                   │               │ ──────────────>│
```

---

## ❤️ SEQUENCE DIAGRAM: Heartbeat Monitoring + Offline Detection

```
Hermes          HeartbeatService    Redis           HVO Backend    Frontend
  │                  │               │                  │             │
  │ Heartbeat stream │               │                  │             │
  │─────────────────>│               │                  │             │
  │ {agent_id, ts}   │               │                  │             │
  │                  │ SET heartbeat │                  │             │
  │                  │───────────────>│                  │             │
  │                  │               │ OK               │             │
  │                  │               │                  │             │
  │ (5s later)       │               │                  │             │
  │ Heartbeat        │               │                  │             │
  │─────────────────>│               │                  │             │
  │                  │ UPDATE        │                  │             │
  │                  │───────────────>│                  │             │
  │ (heartbeat OK)   │               │                  │             │
  │                  │               │                  │             │
  │ (15s no beat)    │               │                  │             │
  │                  │ WATCHDOG TIMER (every 5s)        │             │
  │                  │               │                  │             │
  │                  │ Check timeout │                  │             │
  │                  │<───────────────┤                  │             │
  │                  │ (now - last) > 15s? YES         │             │
  │                  │               │                  │             │
  │                  │ MARK OFFLINE  │                  │             │
  │                  │───────────────────────────────>│             │
  │                  │               │                  │ Status=blocked
  │                  │               │                  │─────────────>│
  │                  │               │                  │ BROADCAST   │
  │                  │               │                  │ agent:status│
  │                  │               │                  │             │ Status badge
  │                  │               │                  │             │ turns orange
  │                  │               │                  │             │<─────
  │ (heartbeat back) │               │                  │             │
  │─────────────────>│               │                  │             │
  │                  │ UPDATE        │                  │             │
  │                  │───────────────>│                  │             │
  │                  │               │                  │             │
  │                  │ WATCHDOG (5s) │                  │             │
  │                  │               │                  │             │
  │                  │ (now - last) < 15s? YES         │             │
  │                  │ Agent recovered!                 │             │
  │                  │               │                  │             │
  │                  │ MARK ONLINE   │                  │             │
  │                  │───────────────────────────────>│             │
  │                  │               │                  │ Status=idle │
  │                  │               │                  │─────────────>│
  │                  │               │                  │ BROADCAST   │
  │                  │               │                  │             │ Status badge
  │                  │               │                  │             │ turns green
  │                  │               │                  │             │<─────
```

---

## 🔐 Shared Memory Data Flow

```
┌─ Read Operation ──────────────────────────────────────┐
│                                                        │
│  1. Agent reads: GET /api/tasks/{id}/memory/{key}    │
│     ├─ Query Redis: hvo:task:{id}:shared:{key}      │
│     ├─ Return: {value, version, written_by, ...}    │
│     └─ Log: audit trail (who read, when)            │
│                                                        │
└────────────────────────────────────────────────────────┘

┌─ Write Operation (Optimistic Locking) ────────────────┐
│                                                        │
│  1. Agent writes: POST /api/tasks/{id}/memory/{key}  │
│     {value: "...", version: 1}                       │
│                                                        │
│  2. Backend checks:                                   │
│     ├─ GET current version from Redis               │
│     └─ If current.version ≠ baseVersion:            │
│        └─ Return 409 CONFLICT                       │
│                                                        │
│  3. If version matches:                              │
│     ├─ MULTI (Redis transaction)                    │
│     ├─ Increment version (v1 → v2)                  │
│     ├─ Write entry {value, v2, agent_id, ts}       │
│     ├─ EXEC                                          │
│     └─ Return new entry                             │
│                                                        │
│  4. Log audit trail:                                 │
│     └─ {taskId, key, write, agent, v2, ts}         │
│                                                        │
└────────────────────────────────────────────────────────┘

┌─ Conflict Resolution ─────────────────────────────────┐
│                                                        │
│  1. Agent gets 409 CONFLICT:                         │
│     {currentVersion: 2, yourVersion: 1, ...}        │
│                                                        │
│  2. Retry Strategy (exponential backoff):            │
│     ├─ Retry #1: wait 100ms                         │
│     ├─ Retry #2: wait 200ms                         │
│     ├─ Retry #3: wait 400ms                         │
│     └─ Max retries: 3                               │
│                                                        │
│  3. Each retry:                                       │
│     ├─ READ current value again                     │
│     ├─ MERGE old + new (merge strategy per key)     │
│     ├─ WRITE with current version                   │
│     └─ If success: continue                         │
│                                                        │
│  4. If all retries fail:                            │
│     ├─ Escalate to operator                         │
│     ├─ Create alert: "Conflict on task:key"        │
│     ├─ Show both versions to operator               │
│     └─ Operator chooses: accept/merge/reject        │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## 💾 Redis Data Schema (Shared Memory)

```
Key: hvo:task:{taskId}:shared:{key}
Value (JSON):
{
  "key": "research_summary",
  "value": "Market trends: AI adoption growing...",
  "version": 2,
  "written_by": "agent-01",
  "written_at": "2026-11-12T10:30:42Z",
  "read_count": 5,
  "write_count": 2,
  "readers": ["agent-01", "agent-02", "agent-03"]
}

Key: hvo:task:{taskId}:shared:{key}:history
Value (JSON array, last 10 versions):
[
  { "version": 0, "value": "Initial...", "written_by": "agent-01", "written_at": "..." },
  { "version": 1, "value": "Updated...", "written_by": "agent-02", "written_at": "..." },
  { "version": 2, "value": "Final...", "written_by": "agent-03", "written_at": "..." }
]

Key: hvo:task:{taskId}:metadata
Value (JSON):
{
  "created_at": "2026-11-12T10:00:00Z",
  "last_modified": "2026-11-12T10:30:42Z",
  "agents": ["agent-01", "agent-02", "agent-03"],
  "keys": ["research_summary", "competitor_list", "recommendations"],
  "status": "in_progress"
}

Key: hvo:heartbeat:{agentId}
Value: Unix timestamp (last heartbeat time)
TTL: 30 seconds (auto-cleanup)
```

---

## 🗄️ PostgreSQL Schema (Audit Trail)

```sql
CREATE TABLE shared_memory_audit (
  id SERIAL PRIMARY KEY,
  task_id VARCHAR(50) NOT NULL,
  key VARCHAR(255) NOT NULL,
  operation VARCHAR(20),      -- read / write / conflict / retry
  agent_id VARCHAR(50) NOT NULL,
  timestamp TIMESTAMP DEFAULT NOW(),
  details JSONB,              -- operation-specific data
  INDEX (task_id, key),
  INDEX (timestamp)
);

-- Details example for write:
{
  "version_before": 1,
  "version_after": 2,
  "value_preview": "First 100 chars...",
  "duration_ms": 15
}

-- Details example for conflict:
{
  "base_version": 1,
  "current_version": 2,
  "last_written_by": "agent-02",
  "retry_attempt": 1,
  "merge_applied": true
}
```

---

## 🔄 Error Recovery Flows

### Scenario 1: Hermes API Timeout

```
┌─ Request to Hermes ─────────────────────┐
│                                          │
│ 1. POST /tasks/dispatch                 │
│    ├─ Timeout after 30s                 │
│    └─ Retry #1 (100ms backoff)          │
│                                          │
│ 2. Retry #1, #2, #3 all timeout        │
│                                          │
│ 3. After max retries:                   │
│    ├─ Log error: "Hermes unavailable"  │
│    ├─ Check circuit breaker state      │
│    └─ If errors > threshold:            │
│       └─ OPEN circuit → use mock       │
│                                          │
│ 4. Response to frontend:                │
│    ├─ "Task queued (on mock)"          │
│    └─ Flag: "Hermes offline"           │
│                                          │
│ 5. When Hermes comes back:              │
│    ├─ Replay queued tasks              │
│    ├─ Sync status                      │
│    └─ CLOSE circuit                    │
│                                          │
└──────────────────────────────────────────┘
```

### Scenario 2: Agent Goes Offline (Heartbeat Timeout)

```
┌─ Watchdog Detects Offline ──────────────┐
│                                          │
│ 1. No heartbeat for 15+ seconds         │
│                                          │
│ 2. Mark agent as "blocked":             │
│    ├─ Update DB: status=blocked        │
│    ├─ Broadcast: agent:status event    │
│    └─ Frontend shows orange badge      │
│                                          │
│ 3. If agent was executing task:         │
│    ├─ Pause task                       │
│    ├─ Log: "Task paused (agent offline)"│
│    └─ Alert operator                   │
│                                          │
│ 4. Heartbeat received again:            │
│    ├─ Mark agent as "idle"             │
│    ├─ Frontend shows green badge       │
│    └─ Offer to resume task             │
│                                          │
│ 5. Operator can:                        │
│    ├─ Resume task (if applicable)      │
│    ├─ Cancel task                      │
│    └─ Reassign to different agent      │
│                                          │
└──────────────────────────────────────────┘
```

---

## 🧪 Testing & Validation

### Unit Tests Required
- [ ] HermesAdapter: task dispatch, event conversion
- [ ] SharedMemoryService: read/write, version tracking
- [ ] ConflictResolution: backoff, merge logic
- [ ] HeartbeatMonitoring: timeout detection
- [ ] ErrorHandling: retries, fallback to mock

### Integration Tests Required
- [ ] Task dispatch → Hermes → events → DB → WebSocket
- [ ] Multi-agent reads/writes (concurrent)
- [ ] Conflict detection → automatic retry
- [ ] Agent offline → pause task → online → resume
- [ ] Rate limit → queue locally → replay

### E2E Test Scenarios
- [ ] 5-agent research task with shared memory
- [ ] 100 concurrent writes to same key
- [ ] Agent crash → heartbeat timeout → offline detection
- [ ] Hermes unavailable → fallback to mock
- [ ] Full workflow: dispatch → execute → complete

---

## 📊 Performance & Scalability

### Targets
- **Task Dispatch Latency:** < 100ms
- **Event Delivery:** < 500ms (WebSocket)
- **Memory Access (Read):** < 10ms
- **Memory Access (Write):** < 20ms (conflict-free)
- **Conflict Detection:** instant (atomic)
- **Heartbeat Reception:** < 5s interval
- **Offline Detection:** < 20s (15s timeout + 5s check interval)

### Scalability
- **Concurrent Tasks:** 100+
- **Concurrent Agents:** 50+
- **Concurrent Memory Writes:** 10+ per key
- **Redis Memory:** < 100MB for 1000 tasks (with shared memory)

---

## 🚀 Deployment Architecture

### Docker Compose Stack

```yaml
services:
  backend:
    image: hvo-backend:v0.2.0
    env:
      HERMES_ENDPOINT: grpc://hermes:50051
      REDIS_URL: redis://redis:6379
      DATABASE_URL: postgres://postgres:password@postgres:5432/hvo

  hermes:
    image: hermes-runtime:latest
    ports:
      - "50051:50051"
    env:
      HERMES_AGENTS: "agent-01,agent-02,agent-03"

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: hvo
      POSTGRES_PASSWORD: password
    volumes:
      - postgres_data:/var/lib/postgresql/data
```

---

**Phase 2 Architecture Finalized:** 2026-10-01  
**Next: Implement Sprint 3 (Oct 29)**  
**Maintained By:** @planning-team
