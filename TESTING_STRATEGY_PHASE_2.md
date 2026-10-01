# Phase 2 Testing Strategy
**Version:** 1.0  
**Date:** 2026-10-01  
**Status:** DETAILED PLAN  

---

## 📋 TESTING OVERVIEW

Phase 2 introduces complexity: real Hermes integration, concurrent memory writes, distributed events. Testing must cover:

1. **Unit Tests** (mock Hermes, isolated services)
2. **Integration Tests** (real Hermes + HVO + Redis)
3. **E2E Tests** (full workflows, multi-agent scenarios)
4. **Stress Tests** (concurrent writes, high load)
5. **Performance Tests** (latency, throughput benchmarks)

**Success Criteria:**
- ✅ Unit test coverage: 85%+
- ✅ All integration tests passing
- ✅ E2E scenarios 100% success rate
- ✅ Stress tests: no data corruption, < 500ms p99 latency
- ✅ Zero unhandled exceptions

---

## 🧪 UNIT TESTS

### Test 1: HermesAdapter - Task Dispatch

**File:** `test/unit/hermes-adapter.spec.ts`

```typescript
describe('HermesAdapter', () => {
  describe('dispatchTask', () => {
    it('should dispatch task and return hermes_task_id', async () => {
      // Setup
      const task = {
        id: 'hvo-task-001',
        title: 'Test task',
        priority: 'high',
        context: {}
      };
      
      const mockHermesResponse = {
        hermes_task_id: 'hermes-t-xyz789',
        status: 'queued'
      };
      
      // Mock HermesClient
      hermesClientMock.dispatchTask.mockResolvedValue(mockHermesResponse);
      
      // Execute
      const result = await adapter.dispatchTask(task);
      
      // Assert
      expect(result).toBe('hermes-t-xyz789');
      expect(hermesClientMock.dispatchTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'hvo-task-001' })
      );
      expect(redisService.set).toHaveBeenCalledWith(
        'hvo:hermes:hvo-task-001',
        'hermes-t-xyz789'
      );
    });

    it('should retry on timeout', async () => {
      hermesClientMock.dispatchTask
        .mockRejectedValueOnce(new TimeoutError())
        .mockResolvedValueOnce({ hermes_task_id: 'hermes-t-123' });
      
      const result = await adapter.dispatchTask(task);
      
      expect(result).toBe('hermes-t-123');
      expect(hermesClientMock.dispatchTask).toHaveBeenCalledTimes(2);
    });

    it('should fallback to mock after max retries', async () => {
      hermesClientMock.dispatchTask.mockRejectedValue(new TimeoutError());
      
      const result = await adapter.dispatchTask(task);
      
      expect(result).toMatch(/mock-/); // Mock returns mock-{id}
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Hermes unavailable')
      );
    });
  });

  describe('subscribeEvents', () => {
    it('should convert Hermes events to CloudEvents', async () => {
      const mockHermesEvent = {
        type: 'task.progress',
        task_id: 'hermes-t-xyz',
        percent: 50,
        message: 'Step 3 complete'
      };
      
      const callback = jest.fn();
      adapter.subscribeEvents(callback);
      
      // Simulate Hermes event
      eventStreamMock.emit(mockHermesEvent);
      
      // Verify CloudEvent conversion
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          specversion: '1.0',
          type: 'task.progress',
          source: 'hermes://hermes-runtime'
        })
      );
    });

    it('should handle stream reconnection', async () => {
      let reconnectAttempts = 0;
      eventStreamMock.on('error', () => {
        reconnectAttempts++;
        if (reconnectAttempts === 1) {
          eventStreamMock.emit('reconnect');
        }
      });
      
      adapter.subscribeEvents(() => {});
      eventStreamMock.emit('error', new Error('Connection lost'));
      
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Reconnecting')
      );
      expect(reconnectAttempts).toBe(1);
    });
  });
});
```

---

### Test 2: SharedMemoryService - Read/Write/Conflict

**File:** `test/unit/shared-memory.spec.ts`

```typescript
describe('SharedMemoryService', () => {
  describe('read', () => {
    it('should read from Redis and return entry with version', async () => {
      const entry = {
        key: 'research_summary',
        value: 'Market analysis...',
        version: 2,
        written_by: 'agent-01',
        written_at: new Date()
      };
      
      redisMock.get.mockResolvedValue(JSON.stringify(entry));
      
      const result = await service.read('task-123', 'research_summary');
      
      expect(result).toEqual(entry);
      expect(redisMock.get).toHaveBeenCalledWith(
        'hvo:task:task-123:shared:research_summary'
      );
    });

    it('should increment read_count on audit trail', async () => {
      redisMock.get.mockResolvedValue(
        JSON.stringify({ value: 'data', version: 1, read_count: 0 })
      );
      
      await service.read('task-123', 'key');
      
      expect(dbMock.auditTrail.create).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'read',
          details: expect.objectContaining({ version: 1 })
        })
      );
    });
  });

  describe('write', () => {
    it('should write and increment version on success', async () => {
      const current = { value: 'old', version: 1 };
      redisMock.get.mockResolvedValue(JSON.stringify(current));
      redisMock.multi.mockReturnValue({
        set: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([null, 1])
      });
      
      const result = await service.write(
        'task-123',
        'key',
        'new value',
        1 // baseVersion
      );
      
      expect(result.version).toBe(2);
      expect(result.value).toBe('new value');
    });

    it('should return 409 CONFLICT on version mismatch', async () => {
      redisMock.get.mockResolvedValue(
        JSON.stringify({ value: 'current', version: 2 })
      );
      
      try {
        await service.write('task-123', 'key', 'new', 1);
        fail('Should throw conflict error');
      } catch (e) {
        expect(e.statusCode).toBe(409);
        expect(e.message).toContain('version mismatch');
        expect(e.details).toEqual({
          currentVersion: 2,
          yourVersion: 1
        });
      }
    });

    it('should handle Redis atomic operation failure', async () => {
      redisMock.multi.mockReturnValue({
        set: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null) // WATCH failed
      });
      
      try {
        await service.write('task-123', 'key', 'value', 1);
        fail('Should throw');
      } catch (e) {
        expect(e.message).toContain('Atomic operation failed');
      }
    });
  });

  describe('conflict detection', () => {
    it('should detect write-write conflict', async () => {
      const agent1Conflict = {
        currentVersion: 2,
        yourVersion: 1,
        lastWrittenBy: 'agent-02',
        lastWrittenAt: new Date()
      };
      
      const result = service.analyzeConflict(agent1Conflict);
      
      expect(result.type).toBe('write-write');
      expect(result.severity).toBe('medium');
      expect(result.suggestedAction).toBe('retry_with_current_version');
    });

    it('should track conflict count and escalate', async () => {
      // Simulate 4 conflicts on same key
      for (let i = 0; i < 4; i++) {
        try {
          await service.write('task-123', 'key', `value${i}`, i);
        } catch (e) {
          service.incrementConflictCount('task-123', 'key');
        }
      }
      
      expect(service.getConflictCount('task-123', 'key')).toBe(4);
      
      if (service.getConflictCount('task-123', 'key') > 3) {
        expect(alertService.escalateConflict).toHaveBeenCalled();
      }
    });
  });
});
```

---

### Test 3: HeartbeatMonitoringService

**File:** `test/unit/heartbeat-monitoring.spec.ts`

```typescript
describe('HeartbeatMonitoringService', () => {
  describe('onHeartbeat', () => {
    it('should update last heartbeat timestamp', async () => {
      const before = Date.now();
      service.onHeartbeat('agent-01');
      const after = Date.now();
      
      const lastBeat = service.getLastHeartbeat('agent-01');
      expect(lastBeat).toBeGreaterThanOrEqual(before);
      expect(lastBeat).toBeLessThanOrEqual(after);
    });

    it('should restore agent status if was offline', async () => {
      // Mark as offline
      service.markAgentOffline('agent-01');
      expect(agentStatusMock.get('agent-01')).toBe('blocked');
      
      // Heartbeat received
      service.onHeartbeat('agent-01');
      
      expect(agentStatusMock.get('agent-01')).toBe('idle');
      expect(webSocketMock.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agent:status',
          agentId: 'agent-01',
          status: 'idle'
        })
      );
    });
  });

  describe('checkOfflineAgents', () => {
    it('should detect offline agent after timeout', async () => {
      const now = Date.now();
      const heartbeat = now - 20000; // 20s ago
      
      redisMock.get.mockResolvedValue(heartbeat);
      
      service.checkOfflineAgents();
      
      expect(service.isOffline('agent-01')).toBe(true);
      expect(alertService.notifyOperator).toHaveBeenCalledWith(
        expect.stringContaining('Agent agent-01 is offline')
      );
    });

    it('should detect recovery within timeout', async () => {
      const now = Date.now();
      const heartbeat = now - 10000; // 10s ago (< 15s)
      
      redisMock.get.mockResolvedValue(heartbeat);
      
      service.checkOfflineAgents();
      
      expect(service.isOffline('agent-01')).toBe(false);
    });

    it('should run watchdog on interval', async () => {
      jest.useFakeTimers();
      service.startWatchdog(5000); // 5s interval
      
      expect(service.checkOfflineAgents).not.toHaveBeenCalled();
      
      jest.advanceTimersByTime(5000);
      expect(service.checkOfflineAgents).toHaveBeenCalledTimes(1);
      
      jest.advanceTimersByTime(5000);
      expect(service.checkOfflineAgents).toHaveBeenCalledTimes(2);
      
      jest.useRealTimers();
    });
  });
});
```

---

## 🔗 INTEGRATION TESTS

### Test 4: Task Dispatch → Hermes → Events → DB → WebSocket

**File:** `test/integration/task-dispatch-e2e.spec.ts`

```typescript
describe('Task Dispatch E2E (Integration)', () => {
  beforeAll(async () => {
    // Start real services (or testcontainers)
    await startTestHermes();
    await startTestRedis();
    await startTestPostgres();
  });

  it('should dispatch task and receive events end-to-end', async () => {
    // 1. Create task via API
    const createRes = await api.post('/api/tasks', {
      title: 'Research project',
      priority: 'high'
    });
    expect(createRes.status).toBe(201);
    const taskId = createRes.body.id;

    // 2. Wait for manager agent to dispatch to Hermes
    await sleep(500);

    // 3. Verify task in database
    const dbTask = await db.tasks.findById(taskId);
    expect(dbTask.status).toBe('assigned');
    expect(dbTask.hermes_task_id).toBeDefined();

    // 4. Verify mapping in Redis
    const hermesId = await redis.get(`hvo:hermes:${taskId}`);
    expect(hermesId).toBe(dbTask.hermes_task_id);

    // 5. Subscribe to WebSocket events
    const wsClient = new WebSocketClient();
    const events = [];
    wsClient.on('message', (evt) => events.push(evt));

    // 6. Wait for Hermes event (task.progress)
    await waitFor(() => events.length > 0, { timeout: 5000 });

    // 7. Verify event format (CloudEvents)
    const progressEvent = events.find(e => e.type === 'task.progress');
    expect(progressEvent).toBeDefined();
    expect(progressEvent.data.task_id).toBe(taskId);

    // 8. Verify task status updated in DB
    const updatedTask = await db.tasks.findById(taskId);
    expect(updatedTask.status).toBe('in_progress');

    wsClient.close();
  });
});
```

---

### Test 5: Concurrent Memory Writes

**File:** `test/integration/concurrent-writes.spec.ts`

```typescript
describe('Concurrent Memory Writes (Integration)', () => {
  it('should handle 10 concurrent writes to shared memory', async () => {
    const taskId = 'task-concurrent-001';
    const key = 'shared_data';
    
    // Setup: initial version 0
    await memoryService.write(taskId, key, 'initial', 0);
    
    // 10 agents attempt to write concurrently
    const promises = [];
    for (let i = 1; i <= 10; i++) {
      promises.push(
        attemptWriteWithRetry(
          taskId,
          key,
          `value${i}`,
          `agent-${i}`,
          3 // max retries
        )
      );
    }
    
    const results = await Promise.all(promises);
    
    // Verify all writes eventually succeeded
    const successful = results.filter(r => r.success);
    expect(successful.length).toBe(10);
    
    // Verify final version is monotonic (0 → 10)
    const final = await memoryService.read(taskId, key);
    expect(final.version).toBe(10);
    
    // Verify audit trail has all writes + conflicts
    const audit = await db.memoryAudit.find({
      taskId,
      key
    });
    const conflicts = audit.filter(a => a.operation === 'conflict');
    expect(conflicts.length).toBeGreaterThan(0); // Expected some conflicts
    
    // Verify no data loss (all values appear in history)
    const history = await memoryService.getHistory(taskId, key);
    expect(history.length).toBeGreaterThanOrEqual(10);
  });
});
```

---

## 🔥 STRESS TESTS

### Test 6: 100 Concurrent Writes to Same Key

**File:** `test/stress/concurrent-writes-stress.spec.ts`

```typescript
describe('Stress Test: 100 Concurrent Writes', () => {
  it('should handle 100 concurrent writes to same key', async () => {
    const taskId = 'task-stress-001';
    const key = 'stress_test_key';
    const agentCount = 5;
    const writesPerAgent = 20;
    
    // Setup
    await memoryService.write(taskId, key, 'initial', 0);
    
    // Execute
    const startTime = Date.now();
    const promises = [];
    
    for (let agent = 1; agent <= agentCount; agent++) {
      for (let write = 1; write <= writesPerAgent; write++) {
        promises.push(
          attemptWriteWithRetry(
            taskId,
            key,
            `agent${agent}-write${write}`,
            `agent-${agent}`,
            3
          )
        );
      }
    }
    
    const results = await Promise.allSettled(promises);
    const duration = Date.now() - startTime;
    
    // Assertions
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success);
    const failed = results.filter(r => r.status === 'rejected' || !r.value.success);
    
    console.log(`
      ✅ Successful writes: ${successful.length} / ${agentCount * writesPerAgent}
      ❌ Failed writes: ${failed.length}
      ⏱️  Duration: ${duration}ms
      📊 Throughput: ${(agentCount * writesPerAgent / (duration / 1000)).toFixed(2)} writes/sec
    `);
    
    // Assertions
    expect(successful.length).toBe(100); // All must succeed eventually
    expect(failed.length).toBe(0);
    
    // Verify final version
    const final = await memoryService.read(taskId, key);
    expect(final.version).toBe(100);
    
    // Performance assertion
    expect(duration).toBeLessThan(10000); // Must complete in < 10s
  });
});
```

---

## 📊 PERFORMANCE TESTS

### Test 7: Memory Access Latencies

**File:** `test/perf/memory-latencies.spec.ts`

```typescript
describe('Performance: Memory Access Latencies', () => {
  it('should measure read latency', async () => {
    const taskId = 'perf-task-001';
    const key = 'perf_key';
    const iterations = 1000;
    
    await memoryService.write(taskId, key, 'test data', 0);
    
    const latencies = [];
    for (let i = 0; i < iterations; i++) {
      const start = process.hrtime.bigint();
      await memoryService.read(taskId, key);
      const end = process.hrtime.bigint();
      latencies.push(Number(end - start) / 1_000_000); // Convert to ms
    }
    
    const stats = calculateStats(latencies);
    console.log(`
      Read Latency:
      - p50: ${stats.p50.toFixed(2)}ms
      - p95: ${stats.p95.toFixed(2)}ms
      - p99: ${stats.p99.toFixed(2)}ms
      - max: ${stats.max.toFixed(2)}ms
    `);
    
    expect(stats.p95).toBeLessThan(10); // Must be < 10ms p95
  });

  it('should measure write latency (no conflicts)', async () => {
    const latencies = [];
    const iterations = 500;
    
    for (let i = 0; i < iterations; i++) {
      const taskId = `perf-write-${i}`;
      const start = process.hrtime.bigint();
      await memoryService.write(taskId, 'key', 'value', 0);
      const end = process.hrtime.bigint();
      latencies.push(Number(end - start) / 1_000_000);
    }
    
    const stats = calculateStats(latencies);
    console.log(`
      Write Latency (no conflicts):
      - p50: ${stats.p50.toFixed(2)}ms
      - p95: ${stats.p95.toFixed(2)}ms
      - p99: ${stats.p99.toFixed(2)}ms
    `);
    
    expect(stats.p95).toBeLessThan(20); // Must be < 20ms p95
  });
});
```

---

## 🎯 SCENARIO TESTS

### Test 8: 5-Agent Research Workflow

**File:** `test/scenarios/5-agent-research.spec.ts`

```typescript
describe('Scenario: 5-Agent Research Workflow', () => {
  it('should complete research task with shared memory sync', async () => {
    // 1. Create task
    const task = await api.post('/api/tasks', {
      title: 'Market research',
      context: { markets: ['US', 'EU', 'APAC'] }
    });
    const taskId = task.body.id;

    // 2. Simulate 5 agents working in parallel
    const agents = ['researcher-1', 'researcher-2', 'analyst-1', 'analyst-2', 'strategist'];
    
    // Phase 1: Research
    console.log('Phase 1: Research (concurrent writes)');
    const phase1Writes = agents.map((agent, idx) => 
      memoryService.write(
        taskId,
        'research_data',
        `Research from ${agent}: ...`,
        idx // version increments
      )
    );
    await Promise.all(phase1Writes);

    // Phase 2: Analysis
    console.log('Phase 2: Analysis (read + write)');
    const analysisResults = [];
    for (const agent of agents.slice(2, 5)) {
      const data = await memoryService.read(taskId, 'research_data');
      const result = await memoryService.write(
        taskId,
        'analysis_results',
        `Analysis: ${data.value.substring(0, 50)}...`,
        analysisResults.length
      );
      analysisResults.push(result);
    }

    // Phase 3: Synthesis
    console.log('Phase 3: Synthesis');
    const analysis = await memoryService.read(taskId, 'analysis_results');
    const strategy = await memoryService.write(
      taskId,
      'strategy',
      `Strategy based on: ${analysis.value.substring(0, 50)}...`,
      0
    );

    // Verify completion
    const auditTrail = await db.memoryAudit.find({ taskId });
    console.log(`✅ Completed with ${auditTrail.length} operations`);
    
    expect(strategy.version).toBeGreaterThan(0);
    expect(auditTrail.filter(a => a.operation === 'write').length).toBeGreaterThan(5);
  });
});
```

---

## ✅ TEST EXECUTION PLAN

### Run Order
```bash
# 1. Unit tests (fast, isolated)
npm run test:unit

# 2. Integration tests (requires testcontainers)
npm run test:integration

# 3. E2E tests (full stack)
npm run test:e2e

# 4. Stress tests (long-running)
npm run test:stress

# 5. Performance benchmarks (optional)
npm run test:perf

# Combined
npm run test:all
```

### Coverage Report
```bash
npm run test:coverage

# Expected output:
# ========== Coverage summary ==========
# Statements   : 88% ( 800/910 )
# Branches     : 82% ( 450/550 )
# Functions    : 90% ( 200/220 )
# Lines        : 88% ( 800/910 )
```

---

## 🚨 FAILURE SCENARIOS

### Scenario 1: Hermes API Timeout
- **Test:** `test/integration/hermes-timeout.spec.ts`
- **Expected:** Retry → fallback to mock → alert operator
- **Verification:** Task still created (on mock), operator notified

### Scenario 2: Agent Crash During Execution
- **Test:** `test/scenarios/agent-crash.spec.ts`
- **Expected:** Heartbeat timeout → mark offline → pause task
- **Verification:** Task paused, operator can resume/reassign

### Scenario 3: Data Corruption (Write Conflict)
- **Test:** `test/integration/conflict-scenarios.spec.ts`
- **Expected:** Detect, retry, escalate if needed
- **Verification:** No data loss, audit trail complete

### Scenario 4: Redis Connection Lost
- **Test:** `test/integration/redis-failure.spec.ts`
- **Expected:** Retry → fallback to PostgreSQL (slower)
- **Verification:** Eventual consistency achieved

---

## 📈 ACCEPTANCE CRITERIA

| Criterion | Target | Verification Method |
|-----------|--------|---------------------|
| Unit test coverage | 85%+ | `npm run test:coverage` |
| Integration tests passing | 100% | `npm run test:integration` |
| E2E test success rate | 100% | Multiple runs |
| Stress test (100 writes) | Zero corruption | Data integrity check |
| Memory read latency | < 10ms p95 | Benchmark report |
| Memory write latency | < 20ms p95 | Benchmark report |
| Conflict resolution | < 3 retries avg | Audit trail analysis |
| No unhandled exceptions | Zero | Log analysis |

---

**Testing Strategy Finalized:** 2026-10-01  
**Next: Implement tests in Sprint 3-4**  
**Maintained By:** @planning-team
