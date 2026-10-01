# Phase 2 Planning: Real Hermes Integration (Sprint 3-4: Oct 29-Nov 26)

**Version:** 1.0  
**Date:** 2026-10-01  
**Sprint:** 3-4 (Oct 29-Nov 26, 4 weeks)  
**Phase:** 2 - Hermes Integration & Shared Memory  
**Status:** PLANNING

---

## 🎯 PHASE 2 GOAL

Replace MockHermesAdapter with real Hermes runtime integration:
1. **Real Agent Dispatch** → Send tasks to actual Hermes runtime
2. **Shared Memory Sync** → Task-scoped Redis keys with optimistic locking
3. **Concurrent Writes** → Conflict resolution (version vectors)
4. **Agent Heartbeat** → Detect offline/stuck agents
5. **Event Loop** → Real-time Hermes event feedback

**Success Metric:** 100% compatibility with real Hermes API, no conflicts on concurrent writes

---

## 📋 USER STORIES (Phase 2)

**US-HA-01: Hermes Runtime Adapter** (Phase 2, Week 1-2)
- Real HermesAdapter implementation (replace mock)
- Integrate with actual Hermes REST API / gRPC
- Dispatch tasks to Hermes runtime
- Track task status via Hermes events
- Handle Hermes errors + retries

**US-HA-02: Heartbeat Monitoring** (Phase 2, Week 1-2)
- Subscribe to agent heartbeat events (from Hermes)
- Detect offline agents (> 15 sec no heartbeat)
- Update agent status: idle → blocked (when offline)
- Alert operator (visual + notification)
- Auto-recovery when agent reconnects

**US-SM-01: Shared Memory (Task-Scoped)** (Phase 2, Week 2-3)
- Task-level Redis key namespace: `hvo:task:{taskId}:shared`
- Agents read/write context within task
- Isolation: no leakage between tasks
- Versioning: track writes for audit trail
- Optimistic locking: detect conflicts

**US-SM-02: Memory Access Indicators** (Phase 2, Week 3)
- Visual indicator (icon) when agent reads/writes shared memory
- Floating animation above avatar
- Tooltip: "Writing to shared memory: research_summary"
- Duration: 1-2 seconds

**US-SM-03: Conflict Resolution** (Phase 2, Week 3-4)
- Concurrent write detection (version mismatch)
- Automatic retry with exponential backoff
- Max retries: 3 (then escalate to human)
- Alert operator if threshold exceeded
- Audit log every conflict

---

## 🏗️ ARCHITECTURE (Hermes Integration)

### Real Hermes Adapter

**Interface (Already Designed, Phase 1):**
```typescript
interface HermesAdapterInterface {
  dispatchTask(task: Task): Promise<string>;      // returns hermes_task_id
  subscribeEvents(cb: (evt: Event) => void): void; // Listen to Hermes events
  getAgentStatus(hermesId: string): Promise<AgentStatus>;
  sendSignal(hermesId: string, signal: 'pause' | 'resume' | 'cancel'): Promise<void>;
}
```

**Implementation (Phase 2):**
```typescript
class RealHermesAdapter implements HermesAdapterInterface {
  private hermesClient: HermesClient; // Real Hermes gRPC/REST client
  
  async dispatchTask(task: Task): Promise<string> {
    // 1. Convert HVO Task → Hermes Task format
    // 2. Call Hermes API: dispatchTask(hermesTask)
    // 3. Return hermes_task_id
    // 4. Subscribe to task events
  }
  
  subscribeEvents(cb: EventCallback) {
    // Listen to Hermes event stream
    // Forward events to HVO via callback
  }
}
```

### Shared Memory Service

```typescript
class SharedMemoryService {
  // Task-scoped Redis keys
  private redis: Redis;
  
  async read(taskId: string, key: string): Promise<SharedMemoryEntry> {
    // Get from: hvo:task:{taskId}:shared
    // Return: {value, version, written_by, written_at}
  }
  
  async write(
    taskId: string,
    key: string,
    value: any,
    baseVersion: number
  ): Promise<SharedMemoryEntry> {
    // Optimistic locking:
    // 1. Check current version == baseVersion
    // 2. If mismatch: return 409 CONFLICT
    // 3. If match: increment version + write
    // 4. Publish event: memory.write
  }
  
  async handleConflict(
    taskId: string,
    key: string,
    conflictCount: number
  ): Promise<void> {
    // If conflictCount > threshold:
    //   - Alert operator
    //   - Pause agent
    //   - Require manual intervention
  }
}
```

### Heartbeat Monitoring

```typescript
class HeartbeatMonitoringService {
  // Subscribe to Hermes agent heartbeats
  
  private readonly heartbeatTimeout = 15000; // 15 seconds
  private agentHeartbeats: Map<string, number> = new Map();
  
  onHeartbeat(agentId: string) {
    this.agentHeartbeats.set(agentId, Date.now());
    // Update agent status: idle (if was blocked)
  }
  
  checkOfflineAgents() {
    // Run every 5 seconds
    for (const [agentId, lastHeartbeat] of this.agentHeartbeats) {
      if (Date.now() - lastHeartbeat > this.heartbeatTimeout) {
        // Agent offline
        this.markAgentBlocked(agentId);
        this.alertOperator(agentId);
      }
    }
  }
}
```

---

## 📦 TECH STACK (Phase 2)

| Layer | Tech | Usage |
|-------|------|-------|
| **Hermes Client** | gRPC / REST | Call Hermes API |
| **Redis** | ioredis | Shared memory + pub/sub |
| **Database** | PostgreSQL + TypeORM | Audit trail |
| **Concurrency** | Mutex / Semaphore | Lock-free writes |
| **Events** | CloudEvents v1.0 | Standard format |

---

## 📋 IMPLEMENTATION PLAN (4 Weeks)

### WEEK 1 (Oct 29-Nov 5): Hermes API Integration

#### Day 1-2: Hermes API Research & Setup
- [ ] Document Hermes API (REST/gRPC endpoints)
- [ ] Setup Hermes client library (gRPC client)
- [ ] Create test Hermes instance (local)
- [ ] Verify connectivity + basic calls

#### Day 3-4: Task Dispatch Implementation
- [ ] Implement dispatchTask() method
- [ ] Convert HVO Task → Hermes Task format
- [ ] Handle Hermes response + errors
- [ ] Implement retry logic (exponential backoff)
- [ ] Test: single task dispatch end-to-end

#### Day 5: Event Subscription
- [ ] Implement subscribeEvents() listener
- [ ] Subscribe to Hermes event stream
- [ ] Convert Hermes events → CloudEvents format
- [ ] Forward to HVO via pub/sub
- [ ] Test: receive task progress events

**Week 1 Deliverable:** Real Hermes adapter working (replace mock)

---

### WEEK 2 (Nov 5-12): Heartbeat + Agent Lifecycle

#### Day 1-2: Heartbeat Monitoring
- [ ] Subscribe to Hermes agent heartbeats
- [ ] Track last heartbeat per agent
- [ ] Implement offline detection (15s timeout)
- [ ] Update agent status in HVO

#### Day 3-4: Error Handling & Recovery
- [ ] Handle agent timeout gracefully
- [ ] Implement auto-recovery logic
- [ ] Alert operator on agent failure
- [ ] Test: agent offline scenario

#### Day 5: Agent Status Sync
- [ ] Sync Hermes agent status ↔ HVO
- [ ] Update avatar status badge (real-time)
- [ ] Implement pause/resume signals
- [ ] Test: full agent lifecycle

**Week 2 Deliverable:** Heartbeat monitoring working

---

### WEEK 3 (Nov 12-19): Shared Memory & Optimistic Locking

#### Day 1-2: Shared Memory Service
- [ ] Implement read/write methods
- [ ] Task-scoped Redis key namespacing
- [ ] Version tracking per entry
- [ ] Audit trail logging

#### Day 3-4: Optimistic Locking
- [ ] Implement version vector checks
- [ ] Conflict detection (version mismatch)
- [ ] Automatic retry with backoff
- [ ] Max retry limit + escalation

#### Day 5: Testing Concurrency
- [ ] Concurrent write tests (2+ agents)
- [ ] Verify no data corruption
- [ ] Measure conflict frequency
- [ ] Performance benchmarking

**Week 3 Deliverable:** Shared memory with conflict resolution working

---

### WEEK 4 (Nov 19-26): Polish & Integration

#### Day 1-2: Visual Indicators
- [ ] Memory access icon implementation
- [ ] Animation on read/write
- [ ] Tooltip with context info
- [ ] Frontend integration

#### Day 2-3: Full E2E Testing
- [ ] Create 5+ agent test scenario
- [ ] Task with shared memory access
- [ ] Verify concurrent writes safe
- [ ] Performance testing (latency, throughput)

#### Day 4-5: Documentation & Deployment
- [ ] Document Hermes API integration
- [ ] Update architecture diagrams
- [ ] Create runbook (Phase 2 operations)
- [ ] Deploy to test environment

**Week 4 Deliverable:** Phase 2 complete + fully integrated

---

## 🔌 HERMES API SPECIFICATION (To Be Detailed)

### Key Endpoints Needed
```
POST   /tasks/dispatch              # Submit task to Hermes
GET    /tasks/{id}/status           # Get task progress
POST   /agents/{id}/signal          # Send control signal (pause/resume/cancel)
GET    /agents/{id}/heartbeat       # Subscribe to heartbeat stream (WebSocket/gRPC)
GET    /events                      # Subscribe to event stream
```

### Required Agent Capabilities
- Task execution (async)
- Tool invocation
- Memory access (read/write context)
- Status reporting
- Error handling + recovery

---

## 📊 SUCCESS METRICS (End of Phase 2)

| Metric | Target | How to Verify |
|--------|--------|---------------|
| **Task Dispatch** | 100% success rate | Hermes logs |
| **Heartbeat Latency** | < 5s | Monitor WebSocket |
| **Conflict Rate** | < 1% of writes | Audit trail |
| **Agent Offline Detection** | < 20s | Watchdog test |
| **Concurrent Writes** | Zero corruption | Database integrity check |
| **Event Propagation** | < 500ms | End-to-end timing |
| **System Uptime** | 99.9% | Monitoring dashboard |

---

## 🧪 TESTING STRATEGY (Phase 2)

### Unit Tests
- [ ] Hermes adapter (mock real API)
- [ ] Shared memory (concurrent writes)
- [ ] Heartbeat logic (timeout detection)
- [ ] Conflict resolution (retry + backoff)

### Integration Tests
- [ ] Real Hermes + HVO end-to-end
- [ ] Task dispatch → progress → completion
- [ ] Multi-agent task execution
- [ ] Shared memory synchronization

### Stress Tests
- [ ] 10+ concurrent tasks
- [ ] 100+ concurrent writes to same key
- [ ] Agent crash/recovery
- [ ] Network latency simulation

---

## 🎯 DEPENDENCIES & RISKS

### Dependencies
- **Hermes API** availability + documentation
- **Hermes Test Instance** for development
- **Agent Capabilities** (memory access support)

### Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|-----------|
| Hermes API unstable | Medium | Design adapter with retry + fallback to mock |
| Conflict rate high | Low | Monitor + adjust retry strategy |
| Heartbeat latency high | Medium | Increase timeout + implement graceful degradation |
| Data corruption on conflict | Very Low | Unit tests + audit trail |

---

## 📅 TIMELINE

```
Phase 2: Oct 29-Nov 26 (4 weeks, 2 sprints)

Sprint 3 (Oct 29-Nov 12): Hermes Integration + Heartbeat
├── Week 1: Hermes API integration
├── Week 2: Heartbeat monitoring
└── Sprint Review (Nov 12)

Sprint 4 (Nov 12-Nov 26): Shared Memory + Polish
├── Week 3: Shared memory + conflict resolution
├── Week 4: Testing + deployment
└── Sprint Review (Nov 26)

Parallel: Phase 1 Frontend continues through Oct 15-29
```

---

## 👥 TEAM REQUIREMENTS

**Backend:** Kamal (continued from Sprint 1-2)
- Implement real HermesAdapter
- Shared memory service
- Heartbeat monitoring

**Frontend:** Frontend dev (from Phase 1)
- Memory access indicators (UI)
- Status badge updates (real Hermes)
- E2E testing

**DevOps:** (Optional)
- Setup test Hermes instance
- Monitoring dashboard
- Performance benchmarking

---

## 📋 NEXT STEPS

1. **Research Hermes API** → Document endpoints + formats
2. **Setup Test Hermes** → Local instance for development
3. **Design Adapter Interface** → Finalize before implementation
4. **Sprint 3 Kickoff** → Oct 29 (after Phase 1 demo)

---

## 📚 REFERENCE DOCUMENTS

- Phase 1 Completion Report (Oct 15)
- Hermes API Documentation (TBD)
- Real Hermes Architecture (TBD)
- ADR-001 (Mock-first strategy) - See docs/ADR.md

---

**Phase 2 Status:** READY FOR PLANNING (Oct 15 after Phase 1 demo)

**Next Team Sync:** Oct 29 (Sprint 3 kickoff)
