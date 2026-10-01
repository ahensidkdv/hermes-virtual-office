# Phase 2 Sprint 3 Backlog: Hermes Adapter + Heartbeat Monitoring
**Oct 29 - Nov 12, 2026 (2 weeks)**

---

## 📌 SPRINT OVERVIEW

**Goal:** Replace MockHermesAdapter with RealHermesAdapter + implement heartbeat monitoring

**Deliverables:**
- ✅ Real Hermes adapter (replaces mock)
- ✅ Task dispatch to Hermes runtime
- ✅ Hermes event subscription + CloudEvents conversion
- ✅ Heartbeat monitoring service (agent online/offline detection)
- ✅ Offline agent status updates (UI badges)

**Success Metrics:**
- 100% task dispatch success rate (or graceful fallback)
- Heartbeat detection < 20 seconds (15s + 5s grace)
- Zero data loss during Hermes API calls
- Agent status synced real-time (< 500ms)

---

## 📅 WEEK 1: Oct 29 - Nov 5

### GOAL: Hermes API Integration Complete

**Points:** 21 | **Complexity:** High | **Risk:** Medium

---

### Day 1-2 (Oct 29-30): Hermes API Research & Setup

**Assigned To:** Kamal

#### RESEARCH TASKS

**Task S3-001: Document Hermes REST/gRPC Endpoints**
- **Story:** US-HA-01
- **Points:** 5 | **Complexity:** Medium
- **Time:** 4-6 hours
- **Dependencies:** None

**Checklist:**
- [ ] Identify Hermes API documentation (official or from team)
- [ ] Document all endpoints needed:
  - `POST /tasks/dispatch` - submit task
  - `GET /tasks/{id}/status` - check progress
  - `GET /agents/{id}/heartbeat` - subscribe to heartbeats (WebSocket/gRPC)
  - `POST /agents/{id}/signal` - send control signal
  - `GET /events` - subscribe to event stream
- [ ] Map Hermes Task format ↔ HVO Task format
- [ ] Identify required authentication (API key, JWT, mTLS)
- [ ] Rate limits + retry-after headers
- [ ] Error codes + status mappings
- **Output:** `HERMES_API_SPECIFICATION.md` (detailed, with examples)
- **Acceptance Criteria:**
  - All endpoints documented
  - Auth method clear
  - Example request/response for each endpoint
  - Error handling strategy defined

---

**Task S3-002: Setup Local Hermes Test Instance**
- **Story:** US-HA-01
- **Points:** 3 | **Complexity:** Low
- **Time:** 2-3 hours
- **Dependencies:** Task S3-001

**Checklist:**
- [ ] Provision Hermes instance (Docker / local binary)
- [ ] Verify connectivity from backend container
- [ ] Basic health check: `curl localhost:{hermes-port}/health`
- [ ] Test basic Hermes API call (e.g., list agents)
- [ ] Setup credentials (if needed)
- **Output:** docker-compose.yml updated OR documentation
- **Acceptance Criteria:**
  - `docker-compose up` spins up Hermes
  - Backend can make HTTP/gRPC calls to Hermes
  - Health check returns 200 OK

---

**Task S3-003: Create Hermes Client Library Wrapper**
- **Story:** US-HA-01
- **Points:** 3 | **Complexity:** Low
- **Time:** 2-3 hours
- **Dependencies:** Task S3-001, Task S3-002

**Checklist:**
- [ ] Install Hermes client library (gRPC or REST)
  - `npm install @hermes/client` (or equivalent)
  - If REST: use axios/fetch wrapper
  - If gRPC: install protobuf definitions
- [ ] Create `src/hermes/hermes-client.ts` wrapper
  - Exposes methods: `dispatchTask()`, `getTaskStatus()`, `sendSignal()`, `subscribeHeartbeats()`, `subscribeEvents()`
  - Handles retries + timeout
  - Centralized logging
- [ ] Add environment variables (Hermes endpoint, credentials)
- **Output:** hermes-client.ts + updated .env.example
- **Acceptance Criteria:**
  - Client instantiates without errors
  - Can make test calls to Hermes
  - Logging enabled

---

### Day 3-4 (Oct 31-Nov 1): Task Dispatch Implementation

**Task S3-004: Implement dispatchTask() in RealHermesAdapter**
- **Story:** US-HA-01
- **Points:** 8 | **Complexity:** High
- **Time:** 6-8 hours
- **Dependencies:** Task S3-003

**Checklist:**
- [ ] Create `src/hermes/real-hermes-adapter.ts`
  - Implements HermesAdapterInterface
  - Constructor: inject HermesClient + Logger + Redis
- [ ] Implement dispatchTask():
  - Convert HVO Task → Hermes Task format
    - Map fields: title, description, priority, tags
    - Serialize context/data to JSON
    - Set timeout + retry policy
  - Call `hermesClient.dispatchTask(hermesTask)`
  - Handle response:
    - Extract `hermes_task_id` from response
    - Store mapping: `hvo_task_id` → `hermes_task_id` in Redis
    - Return `hermes_task_id` to caller
  - Error handling:
    - Hermes API error → log + throw with context
    - Network timeout → retry exponential backoff (3x)
    - After 3 retries → fall back to mock (or return error)
- [ ] Write unit tests:
  - Mock Hermes client
  - Test success case
  - Test retry logic
  - Test error handling
- **Output:** real-hermes-adapter.ts + tests
- **Acceptance Criteria:**
  - dispatchTask() calls Hermes API
  - Task ID mapping persisted
  - Retries work (verified in test)
  - All edge cases handled (no unhandled exceptions)

---

**Task S3-005: Handle Hermes Error Responses**
- **Story:** US-HA-01
- **Points:** 3 | **Complexity:** Medium
- **Time:** 2-3 hours
- **Dependencies:** Task S3-004

**Checklist:**
- [ ] Map Hermes error codes to HVO errors:
  - 400 Bad Request → validation error
  - 401/403 Unauthorized → auth error
  - 429 Too Many Requests → rate limit (retry-after)
  - 500 Server Error → temporary failure (retry)
  - Network timeout → connection error
- [ ] Implement error logger:
  - Log error type + code + message
  - Include Hermes request ID (if available)
  - Alert on critical errors (auth, rate limit)
- [ ] Fallback strategy:
  - Detect Hermes unavailability
  - Switch to MockHermesAdapter gracefully
  - Log warning + alert team
- **Output:** error-handling middleware + tests
- **Acceptance Criteria:**
  - All error codes mapped
  - Fallback to mock on Hermes down
  - Errors logged with context

---

### Day 5 (Nov 2): Event Subscription

**Task S3-006: Implement subscribeEvents() Listener**
- **Story:** US-HA-01
- **Points:** 5 | **Complexity:** Medium
- **Time:** 4-5 hours
- **Dependencies:** Task S3-004

**Checklist:**
- [ ] Subscribe to Hermes event stream (WebSocket / gRPC streaming)
- [ ] Event conversion:
  - Receive Hermes events (native format)
  - Convert to CloudEvents v1.0 format
    - `eventType`: task.progress / task.completed / agent.error / etc.
    - `source`: hermes://hermes-runtime
    - `subject`: task/agent ID
    - `datacontenttype`: application/json
    - `timestamp`: ISO 8601
    - `id`: unique event ID
- [ ] Store event handlers:
  - Hermes task.progress → update task status in DB
  - Hermes task.completed → mark task done, notify operator
  - Hermes task.error → log + alert
  - Hermes agent.error → mark agent blocked, alert
- [ ] Publish converted events:
  - Redis pub/sub `office:events`
  - Frontend WebSocket receives via OfficeGateway
- [ ] Error handling:
  - Hermes event stream dies → auto-reconnect (with backoff)
  - Invalid event format → log + skip
  - Duplicate event → idempotency check (event.id)
- [ ] Unit tests:
  - Mock event stream
  - Verify CloudEvents conversion
  - Test reconnection logic
- **Output:** real-hermes-adapter.subscribeEvents() + event converter
- **Acceptance Criteria:**
  - Hermes events received + converted
  - Events published to Redis
  - Reconnect works on stream failure

---

**Task S3-007: Integration Test - Single Task Dispatch End-to-End**
- **Story:** US-HA-01
- **Points:** 5 | **Complexity:** Medium
- **Time:** 3-4 hours
- **Dependencies:** Task S3-006

**Checklist:**
- [ ] Create `test/integration/hermes-adapter.e2e-spec.ts`
- [ ] Test scenario:
  1. Create task via API: `POST /api/tasks`
  2. ManagerAgent assigns to agent
  3. Agent assigned → dispatch to Hermes
  4. Hermes returns task ID
  5. Subscribe to Hermes events
  6. Hermes sends task.progress event
  7. HVO task status updated in DB
  8. WebSocket broadcasts task:status update
  9. Verify end-to-end (DB + Redis + WebSocket)
- [ ] Assertions:
  - Task exists in HVO DB
  - Task has hermes_task_id
  - Task status updated from progress event
  - WebSocket event received
- **Output:** integration test file
- **Acceptance Criteria:**
  - Test passes end-to-end
  - All components integrated (DB, Redis, WebSocket)

---

## 📊 WEEK 1 SUMMARY

**Completed by Nov 5:**
- ✅ Hermes API documented (HERMES_API_SPECIFICATION.md)
- ✅ Test Hermes instance running
- ✅ RealHermesAdapter implemented (dispatchTask + subscribeEvents)
- ✅ Error handling + retry logic
- ✅ Unit + integration tests passing
- ✅ Ready to test with real tasks

**Story Progress:** US-HA-01 (80% complete) + foundation for US-HA-02

**Blockers/Risks:**
- ⚠️ Hermes API documentation might be incomplete → research + reverse-engineer
- ⚠️ Hermes gRPC vs REST? → decide based on team docs
- ⚠️ Test instance availability? → may need to use mock until real Hermes available

---

---

## 📅 WEEK 2: Nov 5 - Nov 12

### GOAL: Heartbeat Monitoring + Agent Lifecycle Complete

**Points:** 18 | **Complexity:** High | **Risk:** Medium

---

### Day 1-2 (Nov 5-6): Heartbeat Monitoring Service

**Task S3-008: Subscribe to Hermes Heartbeats**
- **Story:** US-HA-02
- **Points:** 5 | **Complexity:** Medium
- **Time:** 4-5 hours
- **Dependencies:** Task S3-006

**Checklist:**
- [ ] Create `src/monitoring/heartbeat.service.ts`
- [ ] Subscribe to Hermes agent heartbeat stream
  - Listen to `/agents/{id}/heartbeat` endpoint (WebSocket/gRPC)
  - OR poll `GET /agents/{id}/status` every 5 seconds
  - Frequency: every 5 seconds (configurable)
- [ ] Track per-agent heartbeats:
  - Map<agentId, lastHeartbeatTime>
  - Initialize on service start
  - Update on each heartbeat received
- [ ] Store in Redis:
  - Key: `hvo:heartbeat:{agentId}` → timestamp
  - TTL: 30 seconds (cleanup stale entries)
- [ ] Error handling:
  - Hermes heartbeat stream fails → retry subscribe
  - Log all heartbeat events (for debugging)
- **Output:** heartbeat.service.ts + Redis schema
- **Acceptance Criteria:**
  - Heartbeats received from Hermes
  - Stored in Redis with TTL
  - Service reconnects on failure

---

**Task S3-009: Offline Agent Detection (Watchdog)**
- **Story:** US-HA-02
- **Points:** 5 | **Complexity:** Medium
- **Time:** 4-5 hours
- **Dependencies:** Task S3-008

**Checklist:**
- [ ] Implement watchdog timer:
  - Run every 5 seconds
  - For each agent in office:
    - Get lastHeartbeat from Redis
    - If (now - lastHeartbeat) > 15s:
      - Mark agent as "blocked"
      - Log: "Agent {id} offline for {duration}ms"
      - Alert operator (TBD in Week 3)
      - Pause any in-progress tasks
    - Else if was previously blocked:
      - Mark agent as "idle" (recovered)
      - Log: "Agent {id} reconnected"
      - Resume any paused tasks (if applicable)
- [ ] Implement in HeartbeatMonitoringService:
  - `checkOfflineAgents()` method
  - `onAgentOffline(agentId)` callback
  - `onAgentOnline(agentId)` callback
- [ ] Unit tests:
  - Simulate heartbeat timeout
  - Verify offline detection
  - Verify recovery detection
- **Output:** watchdog logic + tests
- **Acceptance Criteria:**
  - Offline detection < 20 seconds
  - Status transitions logged
  - Recovery works

---

### Day 3-4 (Nov 7-8): Error Handling & Recovery

**Task S3-010: Handle Agent Timeout Gracefully**
- **Story:** US-HA-02
- **Points:** 3 | **Complexity:** Medium
- **Time:** 3-4 hours
- **Dependencies:** Task S3-009

**Checklist:**
- [ ] When agent goes offline:
  1. Mark agent status as "blocked" in DB
  2. Broadcast `agent:status` event (WebSocket)
  3. Pause active task (if any)
  4. Log: task paused reason
  5. Alert operator (notification badge)
- [ ] When agent comes back online:
  1. Mark agent status as "idle" in DB
  2. Broadcast `agent:status` event (WebSocket)
  3. Can resume task OR wait for operator signal
  4. Log: agent recovered
- [ ] Store pause/resume events:
  - Add to audit trail (PostgreSQL)
  - Queryable: task pause reasons, recovery time
- [ ] Unit tests:
  - Task pause on offline
  - Task resume on online
  - Audit trail entries created
- **Output:** offline/online handlers + audit schema
- **Acceptance Criteria:**
  - Task paused on offline
  - Task resumable on online
  - Audit logged

---

**Task S3-011: Auto-Recovery + Reconnection Logic**
- **Story:** US-HA-02
- **Points:** 5 | **Complexity:** Medium
- **Time:** 3-4 hours
- **Dependencies:** Task S3-010

**Checklist:**
- [ ] Implement exponential backoff for reconnects:
  - First retry: 1s
  - Second retry: 2s
  - Third retry: 4s
  - Max retries: 10
  - Max backoff: 60s
- [ ] For Hermes event stream reconnect:
  - Use same backoff strategy
  - Log each retry attempt
  - Alert if reconnect fails after max retries
- [ ] Graceful degradation:
  - If Hermes event stream down > 5 min:
    - Pause all tasks
    - Alert operator: "Hermes connection lost"
    - Switch to polling mode (less efficient)
  - When Hermes comes back:
    - Resume paused tasks
    - Clear alert
    - Log: "Hermes reconnected"
- [ ] Unit tests:
  - Test backoff sequence
  - Test max retry behavior
  - Test degradation + recovery
- **Output:** reconnection logic + tests
- **Acceptance Criteria:**
  - Backoff works
  - Max retry respected
  - Graceful degradation works

---

### Day 5 (Nov 9): Agent Status Sync

**Task S3-012: Sync Hermes Agent Status ↔ HVO DB**
- **Story:** US-HA-02
- **Points:** 5 | **Complexity:** Medium
- **Time:** 4-5 hours
- **Dependencies:** Task S3-011

**Checklist:**
- [ ] Create `src/agents/agent-sync.service.ts`
- [ ] Bidirectional sync:
  - **Hermes → HVO:**
    - Subscribe to Hermes `agent:status` events
    - Receive status updates (working, idle, error, completed)
    - Update HVO agent status in DB
    - Broadcast via WebSocket
  - **HVO → Hermes:**
    - Operator sends pause/resume/cancel signal
    - Call Hermes `POST /agents/{id}/signal`
    - Update HVO status optimistically
    - Hermes confirms via event
- [ ] Status enum mapping:
  - Hermes: working / idle / error / completed / paused
  - HVO: working / idle / discussing / blocked / reviewing / done
  - Map Hermes status → HVO status intelligently
- [ ] Handle status conflicts:
  - If Hermes says "working" but HVO says "idle" → trust Hermes
  - Log mismatch with warning
  - Sync to HVO state
- [ ] Avatar status badge updates (for Phase 1 frontend):
  - Green: idle (ready for work)
  - Blue: working (executing task)
  - Orange: blocked (offline or error)
  - Purple: discussing (meeting room)
  - Gray: completed (task done)
- [ ] Unit tests:
  - Test status mapping
  - Test conflict resolution
  - Test WebSocket broadcast
- **Output:** agent-sync.service.ts + status mapper
- **Acceptance Criteria:**
  - Hermes → HVO sync works
  - HVO → Hermes signals sent
  - WebSocket updates real-time

---

**Task S3-013: Implement pause/resume Signals**
- **Story:** US-HA-02
- **Points:** 3 | **Complexity:** Low
- **Time:** 2-3 hours
- **Dependencies:** Task S3-012

**Checklist:**
- [ ] API endpoints:
  - `POST /api/agents/{id}/pause` → send pause signal to Hermes
  - `POST /api/agents/{id}/resume` → send resume signal to Hermes
  - Both return: `{success: true, message: "Signal sent"}`
- [ ] Frontend integration points (for Phase 1):
  - Pause button on agent detail panel
  - Resume button (shown when paused)
  - Disabled when agent already paused/offline
- [ ] Authorization:
  - Only operators can pause/resume (add role check)
  - Log who paused + when
- [ ] Error handling:
  - Hermes rejects signal → error message to operator
  - Signal timeout → retry or alert operator
- **Output:** API controllers + authorization
- **Acceptance Criteria:**
  - Pause/resume signals sent to Hermes
  - Frontend can call endpoints
  - Errors handled

---

**Task S3-014: Integration Test - Full Agent Lifecycle**
- **Story:** US-HA-02
- **Points:** 5 | **Complexity:** High
- **Time:** 4-5 hours
- **Dependencies:** Task S3-013

**Checklist:**
- [ ] Create `test/integration/agent-lifecycle.e2e-spec.ts`
- [ ] Test scenario:
  1. Agent starts (heartbeat received)
  2. Verify agent status = "idle"
  3. Task assigned to agent
  4. Agent starts working (Hermes sends event)
  5. Verify agent status = "working"
  6. Simulate agent heartbeat timeout
  7. Verify agent status = "blocked" < 20s
  8. Operator sends pause signal
  9. Verify task paused
  10. Simulate agent heartbeat recovery
  11. Verify agent status = "idle"
  12. Operator sends resume signal
  13. Verify task resumed
  14. Agent completes task (Hermes event)
  15. Verify agent status = "idle"
- [ ] Assertions:
  - All status transitions correct
  - WebSocket broadcasts received
  - DB state consistent
  - Audit trail complete
- **Output:** e2e test file
- **Acceptance Criteria:**
  - Test passes end-to-end
  - All transitions verified

---

## 📊 WEEK 2 SUMMARY

**Completed by Nov 12:**
- ✅ Heartbeat monitoring (subscription + watch dog)
- ✅ Offline detection + recovery
- ✅ Agent status sync (Hermes ↔ HVO)
- ✅ Pause/resume signals working
- ✅ Full agent lifecycle E2E test passing
- ✅ Ready for UI integration (Phase 1 frontend)

**Story Progress:** US-HA-02 (100% complete)

**Code Metrics:**
- Total LOC (Sprint 3): ~2,500
- Test coverage: 85%+
- Integration tests: 5+
- Unit tests: 20+

**Blockers/Risks:**
- ⚠️ Hermes heartbeat API latency? → monitor + adjust timeout if needed
- ⚠️ Network instability during testing? → use chaos monkey test later
- ⚠️ Race condition in status sync? → add distributed lock (Redis)

---

## 🎯 SPRINT 3 SUCCESS CRITERIA

**Go/No-Go Decision on Nov 12:**

| Criterion | Target | Status |
|-----------|--------|--------|
| RealHermesAdapter working | 100% task dispatch success | Must verify |
| Hermes event subscription | Events received + converted | Must verify |
| Heartbeat monitoring | < 20s offline detection | Must verify |
| Agent status sync | Real-time updates < 500ms | Must verify |
| Unit test coverage | 85%+ | Must verify |
| Integration tests passing | 5+ scenarios | Must verify |
| No unhandled exceptions | Zero critical bugs | Must verify |
| Code review + merge | All PRs approved | Must verify |
| Documentation | HERMES_API_SPECIFICATION.md + architecture | Must complete |

**Blockers for Phase 2 continuation:**
- ❌ Hermes API not available → stay on mock until available
- ❌ Heartbeat timeout > 30s → adjust thresholds
- ❌ Data corruption on status sync → fix + add tests
- ❌ Event stream unstable → implement better retry logic

**Go/No-Go:** Proceed to Sprint 4 if ✅ all green, OR Continue Sprint 3 if blockers present.

---

## 📚 DELIVERABLES (End of Sprint 3)

### Code
- `src/hermes/real-hermes-adapter.ts` (400+ LOC)
- `src/hermes/hermes-client.ts` (150+ LOC)
- `src/monitoring/heartbeat.service.ts` (300+ LOC)
- `src/agents/agent-sync.service.ts` (250+ LOC)
- `test/integration/hermes-adapter.e2e-spec.ts` (150+ LOC)
- `test/integration/agent-lifecycle.e2e-spec.ts` (200+ LOC)

### Documentation
- `HERMES_API_SPECIFICATION.md` (completed Week 1)
- `ARCHITECTURE_PHASE_2.md` (draft, finalized in Sprint 4)
- API endpoint examples + error handling guide
- Hermes integration runbook

### Artifacts
- Docker Compose with Hermes instance running
- GitHub commits (10+)
- Sprint 3 retrospective + metrics

---

## 🔄 HANDOFF TO SPRINT 4

**Prerequisites for Sprint 4 (Nov 12):**
1. ✅ RealHermesAdapter stable
2. ✅ Heartbeat monitoring working
3. ✅ Agent lifecycle verified
4. ✅ No data loss on Hermes events
5. ✅ All tests passing

**Sprint 4 starts with:** Shared memory + conflict resolution

---

**Sprint 3 Created:** 2026-10-01  
**Last Updated:** 2026-10-01  
**Maintained By:** @planning-team
