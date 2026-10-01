# Phase 2 Risks & Mitigations
**Version:** 1.0  
**Date:** 2026-10-01  
**Status:** ACTIVE PLANNING  

---

## 📋 RISK SUMMARY

Phase 2 introduces real Hermes integration, distributed state management, and concurrent writes. High complexity = high risk. This document identifies risks, likelihood, impact, and mitigation strategies.

---

## 🔴 CRITICAL RISKS (Must Address)

### RISK-001: Hermes API Unavailability

**Description:** Hermes runtime is unavailable, down, or unreachable.

**Likelihood:** Medium (depends on Hermes team's infrastructure)

**Impact:** High (no tasks can be executed, Phase 2 blocked)

**Symptoms:**
- Cannot connect to Hermes (network error)
- Hermes returns 503 Service Unavailable
- Hermes API latency > 30s (timeout)
- Hermes event stream closed

**Mitigations:**

1. **Fallback to MockHermesAdapter** (Circuit Breaker Pattern)
   - Track Hermes error rate
   - If errors > threshold (5 per minute):
     - Switch to mock adapter
     - Log warning: "Hermes unavailable, using mock"
     - Alert operator via dashboard
   - Persist tasks locally (queue in Redis/PostgreSQL)
   - Replay tasks when Hermes recovers

2. **Graceful Degradation**
   - Mock adapter continues accepting tasks
   - Frontend shows: "Hermes offline - mock mode active"
   - No user-facing service disruption
   - Operator can pause new task submissions (optional)

3. **Retry Strategy**
   - Max retries: 3
   - Backoff: 100ms, 200ms, 400ms
   - Max backoff: 30 seconds
   - Don't retry on 400/401/403 (auth errors)

4. **Testing**
   - [ ] Test Hermes connection failure
   - [ ] Test circuit breaker activation
   - [ ] Test mock fallback
   - [ ] Test task replay when Hermes returns
   - [ ] Verify no data loss

5. **Detection & Alerting**
   - Metrics: Hermes error rate, latency, availability
   - Alert threshold: > 5% error rate
   - Alert channel: Dashboard + Email + Slack (if available)

**Acceptance Criteria:**
- ✅ Fallback to mock works
- ✅ Circuit breaker auto-activates
- ✅ Tasks queued locally while down
- ✅ Replay works when Hermes back
- ✅ Operator notified

---

### RISK-002: Concurrent Write Conflicts (Data Loss)

**Description:** Multiple agents write to same shared memory key simultaneously, causing data corruption or loss.

**Likelihood:** Medium (depends on workload + task design)

**Impact:** Critical (data corruption = unreliable system)

**Scenarios:**
- Agent 1 & 2 both read v0, both try to write
- Agent 1 wins, Agent 2 gets 409 CONFLICT
- Agent 2 retries but picks wrong strategy
- Merge logic incorrect → data loss

**Mitigations:**

1. **Optimistic Locking with Version Vectors**
   - Every entry has monotonic version (0, 1, 2, ...)
   - Write requires: `write(key, value, baseVersion)`
   - Check: `if current.version ≠ baseVersion → 409 CONFLICT`
   - Atomic check-and-set (Redis MULTI/EXEC)

2. **Automatic Conflict Resolution**
   - Retry with exponential backoff (100ms, 200ms, 400ms)
   - Re-read current value + version
   - Apply merge logic (key-specific):
     - Strings: append + timestamp
     - Lists: concatenate + dedupe
     - Objects: deep merge
   - Max retries: 3

3. **Escalation to Operator**
   - After max retries → can't resolve automatically
   - Alert operator: "Conflict on task:key, needs manual review"
   - Show:
     - Current value (v2)
     - Agent's proposed value
     - Conflict history
   - Operator chooses: accept current / accept proposed / merge manually

4. **Audit Trail**
   - Log every conflict with:
     - Task ID, key, version
     - Both values
     - Retry attempt #
     - Resolution
   - Queryable: `GET /api/tasks/{id}/memory/audit?operation=conflict`
   - Used for debugging + compliance

5. **Testing**
   - [ ] Unit: conflict detection
   - [ ] Integration: 10 concurrent writes (2+ conflicts expected)
   - [ ] Stress: 100 concurrent writes (measure conflict rate)
   - [ ] Scenario: agent merge logic (strings, lists, objects)
   - [ ] Failure: max retries → escalation

**Acceptance Criteria:**
- ✅ Conflicts detected correctly (< 100ms latency)
- ✅ Automatic retry works (avg 1-2 attempts)
- ✅ Merge logic correct (no data loss)
- ✅ Operator escalation working
- ✅ Audit trail complete (100% of writes logged)

---

### RISK-003: Heartbeat Latency (False Offline Detection)

**Description:** Agent is still executing but heartbeat not received, wrongly marked as "offline" and task paused.

**Likelihood:** Medium (network latency, high load)

**Impact:** High (task interruption, poor UX)

**Scenarios:**
- Heartbeat every 5s normally
- Network spike → heartbeat delayed 20s
- HVO marks agent offline (timeout > 15s)
- Task paused even though agent still working
- Operator gets false alert

**Mitigations:**

1. **Configurable Heartbeat Timeout**
   - Default: 15 seconds (generous)
   - Can be tuned: `HERMES_HEARTBEAT_TIMEOUT_MS=15000`
   - Based on network conditions, monitored post-deployment

2. **Grace Period Logic**
   - Heartbeat > 15s:
     - If 15-20s: warning (don't pause yet)
     - If > 20s: mark offline + pause
   - Monitor heartbeat latency percentiles
   - Alert if p95 > 12s (approaching threshold)

3. **Adaptive Timeout** (Optional, Phase 3)
   - Track average heartbeat latency
   - Adjust timeout dynamically: median + 3σ (3 std deviations)
   - Recompute every 5 minutes
   - Max timeout: 30 seconds (safety limit)

4. **Manual Recovery**
   - Operator sees agent marked "offline"
   - Can manually mark as "online" (override)
   - Or resume paused task if false alarm
   - Log: "Operator overrode offline status"

5. **Testing**
   - [ ] Measure heartbeat latency under normal conditions
   - [ ] Simulate network delay (add 10s latency)
   - [ ] Verify: delayed heartbeat triggers timeout at 15s
   - [ ] Test: operator override
   - [ ] Test: grace period (15-20s doesn't pause)

**Acceptance Criteria:**
- ✅ Heartbeat latency < 5s normally (p50 < 3s)
- ✅ Timeout: 15s (configurable)
- ✅ No false positives under normal conditions
- ✅ Grace period prevents premature pause
- ✅ Operator override works

---

### RISK-004: Data Corruption (Atomic Operation Failure)

**Description:** Redis atomic operation (MULTI/EXEC) fails, leaving data in inconsistent state.

**Likelihood:** Low (Redis atomic ops are reliable)

**Impact:** Critical (corrupted shared memory)

**Scenarios:**
- WATCH on key fails (concurrent update)
- MULTI setup but EXEC fails
- Redis connection lost mid-transaction
- Partial write (key written, version not)

**Mitigations:**

1. **Proper Transaction Handling**
   - Use Redis WATCH + MULTI + EXEC correctly
   - On EXEC failure (returns null):
     - Retry the operation
     - Not: proceed as if succeeded
   - Max retries: 3

2. **Idempotency**
   - Every write is idempotent
   - If retry happens:
     - Same version check
     - Same merge result
     - Can safely retry
   - No duplicate side effects (logging ok, but only once)

3. **Consistency Checks**
   - After write: verify version incremented
   - Audit trail: compare written value with Redis entry
   - Periodic: scan for orphaned entries (version gaps)
   - Daily: consistency report (errors if any)

4. **Testing**
   - [ ] Unit: WATCH failure → retry
   - [ ] Integration: simulate Redis connection loss
   - [ ] Stress: 1000 concurrent writes → no gaps in versions
   - [ ] Audit: verify all writes logged
   - [ ] Recovery: detect + report inconsistencies

**Acceptance Criteria:**
- ✅ EXEC failure handled (retry)
- ✅ No partial writes (atomic guaranteed)
- ✅ Versions monotonic (no gaps)
- ✅ Audit trail matches Redis state
- ✅ Inconsistency detection + alerts

---

## 🟠 MAJOR RISKS (Likely Issues)

### RISK-005: Agent Crash During Execution

**Description:** Agent process crashes while executing task, no graceful shutdown.

**Likelihood:** Medium (agents are external processes)

**Impact:** High (task stalled, operator intervention needed)

**Mitigations:**

1. **Heartbeat Timeout Detection**
   - No heartbeat > 15s → mark offline
   - Pause in-progress task
   - Alert operator: "Agent crashed or disconnected"

2. **Task Resume/Reassign**
   - Operator can:
     - Pause + wait (agent may recover)
     - Pause + resume (if agent back)
     - Cancel (abandon task)
     - Reassign (pick different agent)
   - Log: who did what, when

3. **State Recovery**
   - When agent reconnects (heartbeat received):
     - Mark as online
     - Offer to resume paused tasks
     - Or start fresh (operator choice)

4. **Testing**
   - [ ] Simulate agent disconnect
   - [ ] Verify timeout detection < 20s
   - [ ] Test: pause + resume
   - [ ] Test: task recovery on reconnect

**Acceptance Criteria:**
- ✅ Crash detected < 20s
- ✅ Task paused automatically
- ✅ Operator can resume/reassign
- ✅ No task data lost

---

### RISK-006: Shared Memory Explosion (Memory Leak)

**Description:** Shared memory grows unbounded, Redis memory exhausted.

**Likelihood:** Low (with proper TTL policy)

**Impact:** Medium (Redis OOM, everything slows)

**Scenarios:**
- Tasks never cleaned up (TTL not set)
- Many concurrent tasks = many keys
- Each key has version history
- Redis memory hits limit

**Mitigations:**

1. **TTL Policy**
   - Task-scoped keys: TTL = task completion + 24h
   - Metadata: TTL = task completion + 7d
   - History (per key): keep only last 10 versions
   - Auto-cleanup: Redis EXPIRE

2. **Monitoring**
   - Track Redis memory usage
   - Alert if > 70% of allocated memory
   - Dashboard: active tasks, key count, memory

3. **Cleanup Job**
   - Daily job: scan for expired tasks
   - Remove all related keys
   - Log: "Cleaned up {N} expired tasks"

4. **Testing**
   - [ ] Create 1000 tasks with shared memory
   - [ ] Verify total Redis memory < 100MB
   - [ ] Measure memory/task
   - [ ] Test: cleanup job removes expired keys

**Acceptance Criteria:**
- ✅ Memory grows linearly (not exponential)
- ✅ Total memory < 100MB for 1000 tasks
- ✅ Cleanup job removes expired entries
- ✅ No alert triggered (stays < 70%)

---

### RISK-007: Hermes Event Stream Dies

**Description:** Hermes event stream disconnects, HVO stops receiving updates.

**Likelihood:** Medium (WebSocket/gRPC streams fragile)

**Impact:** Medium (stale task status, no progress updates)

**Mitigations:**

1. **Reconnection Logic**
   - Subscribe → error/disconnect → auto-reconnect
   - Exponential backoff: 1s, 2s, 4s, 8s, 30s (max)
   - Log each reconnect attempt
   - Max retries: 10

2. **Fallback to Polling**
   - If reconnect fails for > 5 minutes:
     - Switch to polling (less efficient)
     - `GET /tasks/{id}/status` every 10s
     - Update task status from responses
     - Alert operator: "Event stream degraded, using polling"

3. **Event Deduplication**
   - Store event IDs received
   - If re-subscribed: skip duplicates
   - Prevents double-processing

4. **Testing**
   - [ ] Simulate stream disconnect
   - [ ] Verify reconnect works
   - [ ] Test: backoff sequence
   - [ ] Test: fallback to polling
   - [ ] Test: event dedup

**Acceptance Criteria:**
- ✅ Reconnect works automatically
- ✅ Max reconnect time: 30s
- ✅ Fallback to polling on repeated failures
- ✅ No duplicate event processing

---

## 🟡 MINOR RISKS (Nice to Have Mitigations)

### RISK-008: Performance Regression

**Description:** Shared memory + heartbeat monitoring slows down API responses.

**Likelihood:** Low (services are async)

**Impact:** Low (UX degradation)

**Mitigations:**
- Monitor API latencies (p50, p95, p99)
- Alert if > 10% regression
- Optimize hot paths (caching, indexing)
- Load testing before deployment

### RISK-009: Frontend Indicator Too Noisy

**Description:** Memory access indicator flashes too frequently, distracting operator.

**Likelihood:** Medium (depends on workload)

**Impact:** Low (UX issue)

**Mitigations:**
- Indicator duration: 1-2s (configurable)
- Throttle: max 10 indicators/sec per agent
- Opacity fade-out (less jarring)

### RISK-010: Rate Limit Exhaustion

**Description:** Too many requests to Hermes, hit rate limits.

**Likelihood:** Medium (depends on Hermes quotas)

**Impact:** Medium (tasks queued, slow execution)

**Mitigations:**
- Monitor rate limit headers (X-RateLimit-Remaining)
- Queue tasks locally when approaching limit
- Replay when quota resets
- Notify operator before exhaustion

---

## 📊 RISK MATRIX

| Risk | Likelihood | Impact | Priority | Status |
|------|-----------|--------|----------|--------|
| Hermes API unavailable | Medium | High | CRITICAL | Plan |
| Concurrent write conflicts | Medium | Critical | CRITICAL | Plan |
| Heartbeat latency false positives | Medium | High | CRITICAL | Plan |
| Data corruption (atomic failure) | Low | Critical | CRITICAL | Plan |
| Agent crash | Medium | High | MAJOR | Plan |
| Memory leak (Redis OOM) | Low | Medium | MAJOR | Plan |
| Event stream dies | Medium | Medium | MAJOR | Plan |
| Performance regression | Low | Low | MINOR | Plan |
| Indicator too noisy | Medium | Low | MINOR | Plan |
| Rate limit exhaustion | Medium | Medium | MAJOR | Plan |

---

## 📋 MITIGATION CHECKLIST

**Before Sprint 3 Starts:**
- [ ] Design fallback to mock (circuit breaker)
- [ ] Design conflict resolution (version vectors + retry)
- [ ] Design heartbeat monitoring (timeout + grace period)
- [ ] Design atomic transaction handling
- [ ] Design reconnection logic (event stream)
- [ ] Create monitoring dashboard (metrics + alerts)
- [ ] Create alerting thresholds (error rate, latency, memory)

**During Sprint 3-4:**
- [ ] Implement all mitigations
- [ ] Test each mitigation (unit + integration)
- [ ] Load test before Phase 3

**Before Phase 3 Kickoff:**
- [ ] All tests passing
- [ ] Monitoring + alerting verified
- [ ] Runbook + recovery procedures documented
- [ ] Operator trained on alerts + recovery

---

## 🚀 CONTINGENCY PLANS

### If Hermes API Unavailable
1. Use mock adapter (ready to go)
2. Queue tasks locally
3. Notify team + timeline for recovery
4. Replay tasks when Hermes returns

### If Conflict Rate > 10%
1. Review task design (too many writes to same key?)
2. Increase retry backoff (slower retries)
3. Implement merge strategy per key-type
4. Alert operator for manual review

### If Heartbeat Timeouts Are Too Frequent
1. Increase timeout threshold (e.g., 20s → 25s)
2. Implement grace period (don't pause at threshold)
3. Investigate network conditions
4. Consider adaptive timeout

### If Data Corruption Detected
1. STOP processing (pause all tasks)
2. Alert team immediately (critical)
3. Investigate audit trail (what happened?)
4. Recover from backup (restore shared memory)
5. Post-mortem + fix root cause

---

**Risk Assessment Completed:** 2026-10-01  
**Next: Review with team + finalize mitigations**  
**Maintained By:** @planning-team
