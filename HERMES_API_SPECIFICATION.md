# Hermes API Specification (Phase 2)
**Version:** 1.0-draft  
**Date:** 2026-10-01  
**Status:** RESEARCH REQUIRED (Details TBD from Hermes team)  

---

## 📋 OVERVIEW

This specification documents the Hermes API endpoints, event formats, authentication, and error handling required for HVO's Phase 2 integration. This is the **contract between HVO and Hermes runtime**.

**Key Integration Points:**
1. Task dispatch (HVO → Hermes)
2. Task status monitoring (Hermes → HVO)
3. Agent heartbeat (Hermes → HVO)
4. Agent control signals (HVO → Hermes)
5. Event streaming (Hermes → HVO)

---

## 🔐 AUTHENTICATION & SECURITY

### Authorization Mechanism
- **Type:** To be determined (Options: API Key, JWT, mTLS, OAuth2)
- **Scope:** Research question for Hermes team

**Required Information:**
- [ ] What is the primary auth method Hermes uses?
- [ ] Is it bearer token, API key, mutual TLS, or other?
- [ ] Who issues credentials? (env-based, config server, etc.)
- [ ] Token expiration policy?
- [ ] Refresh token flow (if applicable)?

### Expected Solution
```typescript
// Backend config
HERMES_ENDPOINT=grpc://hermes:50051
HERMES_API_KEY=sk_live_xxxxx           // or
HERMES_CLIENT_CERT=/etc/certs/client.pem // or
HERMES_CLIENT_KEY=/etc/certs/client.key
```

### Recommended Approach (if not specified)
- Use **API Key in Authorization header** for simplicity
- Format: `Authorization: Bearer {HERMES_API_KEY}`
- Store key in environment variables
- Rotate quarterly

---

## 🚀 API ENDPOINTS (REST vs gRPC)

### Protocol Decision Required
- [ ] **REST over HTTPS?** (easier debugging, higher overhead)
- [ ] **gRPC?** (better performance, binary format)
- [ ] **Hybrid?** (REST for control, gRPC for streaming)

**Assumption for this spec:** REST with optional gRPC for streaming events (best of both)

---

### 1. POST /tasks/dispatch
**Submit a task to Hermes for execution**

**Request:**
```http
POST /tasks/dispatch HTTP/1.1
Authorization: Bearer {HERMES_API_KEY}
Content-Type: application/json

{
  "id": "hvo-task-abc123",           // HVO task ID (for mapping)
  "title": "Research market trends",
  "description": "Analyze competitive landscape",
  "priority": "high",                 // high / normal / low
  "tags": ["research", "market"],
  "timeout_seconds": 3600,           // Max execution time
  "retry_policy": {
    "max_retries": 3,
    "backoff_multiplier": 2.0,       // exponential backoff
    "initial_delay_ms": 1000
  },
  "context": {
    "keywords": ["AI", "LLMs"],
    "target_audience": "technical",
    "depth": "comprehensive"
  },
  "execution_mode": "sequential",    // sequential / parallel
  "required_capabilities": [
    "web_search",
    "summarization",
    "competitive_analysis"
  ]
}
```

**Response (201 Created):**
```json
{
  "hermes_task_id": "hermes-t-xyz789",  // Hermes task ID (for tracking)
  "status": "queued",                   // queued / running / completed / failed
  "created_at": "2026-11-01T10:00:00Z",
  "estimated_completion": "2026-11-01T11:00:00Z"
}
```

**Error Responses:**
- `400 Bad Request` - Invalid task format
  ```json
  {
    "error": "ValidationError",
    "message": "Missing required field: title",
    "details": { "field": "title", "constraint": "required" }
  }
  ```
- `401 Unauthorized` - Invalid credentials
  ```json
  {
    "error": "AuthenticationError",
    "message": "Invalid API key"
  }
  ```
- `429 Too Many Requests` - Rate limited
  ```json
  {
    "error": "RateLimitError",
    "message": "Too many requests",
    "retry_after_seconds": 60
  }
  ```
- `503 Service Unavailable` - Hermes overloaded
  ```json
  {
    "error": "ServiceUnavailable",
    "message": "Hermes is currently overloaded. Try again in 30s"
  }
  ```

---

### 2. GET /tasks/{hermes_task_id}/status
**Get current status of a task**

**Request:**
```http
GET /tasks/hermes-t-xyz789/status HTTP/1.1
Authorization: Bearer {HERMES_API_KEY}
```

**Response (200 OK):**
```json
{
  "hermes_task_id": "hermes-t-xyz789",
  "hvo_task_id": "hvo-task-abc123",   // Map back to HVO
  "status": "running",                 // queued / running / completed / failed
  "progress": {
    "percent": 45,
    "current_step": "Analyzing competitors",
    "steps_completed": 2,
    "steps_total": 5
  },
  "assigned_agent": {
    "hermes_id": "agent-hermes-001",
    "name": "ResearchBot",
    "capabilities": ["web_search", "analysis"]
  },
  "started_at": "2026-11-01T10:05:00Z",
  "updated_at": "2026-11-01T10:30:00Z",
  "estimated_completion": "2026-11-01T10:50:00Z"
}
```

**Error Responses:**
- `404 Not Found` - Task doesn't exist
  ```json
  {
    "error": "NotFoundError",
    "message": "Task hermes-t-xyz789 not found"
  }
  ```
- `410 Gone` - Task expired (deleted after N days)
  ```json
  {
    "error": "TaskExpired",
    "message": "Task data has been archived"
  }
  ```

---

### 3. POST /agents/{agent_id}/signal
**Send control signal to an agent (pause/resume/cancel)**

**Request:**
```http
POST /agents/agent-hermes-001/signal HTTP/1.1
Authorization: Bearer {HERMES_API_KEY}
Content-Type: application/json

{
  "signal": "pause",                  // pause / resume / cancel
  "reason": "Operator review requested",
  "timeout_seconds": null             // Auto-resume after N seconds (optional)
}
```

**Response (202 Accepted):**
```json
{
  "agent_id": "agent-hermes-001",
  "signal": "pause",
  "status": "acknowledged",           // acknowledged / executing / confirmed
  "task_id": "hermes-t-xyz789",
  "message": "Agent paused at step 3/5"
}
```

**Error Responses:**
- `400 Bad Request` - Invalid signal
  ```json
  {
    "error": "InvalidSignal",
    "message": "Signal must be: pause / resume / cancel"
  }
  ```
- `404 Not Found` - Agent doesn't exist
- `409 Conflict` - Agent not in task execution
  ```json
  {
    "error": "AgentNotExecuting",
    "message": "Agent is not currently executing a task"
  }
  ```

---

### 4. GET /agents/{agent_id}/heartbeat (WebSocket or gRPC Streaming)
**Subscribe to agent heartbeat stream**

**Connection (WebSocket):**
```http
GET /agents/agent-hermes-001/heartbeat HTTP/1.1
Authorization: Bearer {HERMES_API_KEY}
Upgrade: websocket
Connection: Upgrade
```

**Heartbeat Events (received every 1-5 seconds):**
```json
{
  "agent_id": "agent-hermes-001",
  "timestamp": "2026-11-01T10:30:42.123Z",
  "status": "running",                // running / idle / paused / error / offline
  "current_task_id": "hermes-t-xyz789",
  "cpu_usage": 45.2,                 // Percentage
  "memory_usage_mb": 256,
  "last_action": "Completed step 3/5",
  "uptime_seconds": 86400            // Agent process uptime
}
```

**Connection States:**
- **Connected:** Heartbeats flowing
- **Timeout:** No heartbeat > 15 seconds → agent considered offline
- **Disconnected:** WebSocket closed
- **Reconnect:** Auto-reconnect with exponential backoff

---

### 5. GET /events (WebSocket or gRPC Streaming)
**Subscribe to real-time event stream (all tasks & agents)**

**Connection (WebSocket):**
```http
GET /events HTTP/1.1
Authorization: Bearer {HERMES_API_KEY}
Upgrade: websocket
Connection: Upgrade

// Optional filter (query params)
?task_id=hermes-t-xyz789&types=task.progress,agent.error
```

**Event Format (CloudEvents v1.0 Compatibility):**
```json
{
  "specversion": "1.0",
  "type": "task.progress",            // Event type
  "source": "hermes://task/hermes-t-xyz789",
  "subject": "agent-hermes-001",      // Agent performing action
  "id": "evt-abc123def456",           // Unique event ID
  "time": "2026-11-01T10:30:42.123Z",
  "datacontenttype": "application/json",
  "data": {
    "task_id": "hermes-t-xyz789",
    "agent_id": "agent-hermes-001",
    "step_number": 3,
    "step_total": 5,
    "message": "Completed step 3: Analyzing competitors"
  }
}
```

**Common Event Types:**

**task.queued** - Task added to queue
```json
{ "type": "task.queued", "data": { "task_id": "...", "position_in_queue": 5 } }
```

**task.started** - Execution started
```json
{ "type": "task.started", "data": { "task_id": "...", "agent_id": "..." } }
```

**task.progress** - Step completed
```json
{ "type": "task.progress", "data": { "task_id": "...", "step": "...", "percent": 45 } }
```

**task.completed** - Task finished successfully
```json
{
  "type": "task.completed",
  "data": {
    "task_id": "...",
    "agent_id": "...",
    "result": { "summary": "...", "output": {...} },
    "duration_seconds": 3600,
    "tokens_used": 12500
  }
}
```

**task.failed** - Task execution failed
```json
{
  "type": "task.failed",
  "data": {
    "task_id": "...",
    "agent_id": "...",
    "error": "TimeoutError",
    "message": "Task exceeded 3600s timeout",
    "retry_possible": true
  }
}
```

**agent.error** - Agent encountered an error
```json
{
  "type": "agent.error",
  "data": {
    "agent_id": "...",
    "task_id": "...",
    "error_type": "ToolExecutionError",
    "message": "Web search failed: rate limited",
    "recovery_action": "Retry in 60s"
  }
}
```

**agent.offline** - Agent stopped responding
```json
{ "type": "agent.offline", "data": { "agent_id": "...", "reason": "No heartbeat" } }
```

**agent.online** - Agent reconnected
```json
{ "type": "agent.online", "data": { "agent_id": "..." } }
```

---

## 🔄 ERROR HANDLING STRATEGY

### HTTP Status Code Mapping

| Code | Meaning | Hermes → HVO Action |
|------|---------|---------------------|
| 200 | OK | Accept response |
| 201 | Created | Task queued successfully |
| 202 | Accepted | Signal acknowledged (async) |
| 400 | Bad Request | Validate request format before resending |
| 401 | Unauthorized | Check API key + credentials |
| 403 | Forbidden | Check authorization + API key scope |
| 404 | Not Found | Task/Agent ID invalid or expired |
| 409 | Conflict | Agent not in expected state → retry later |
| 429 | Rate Limited | Wait (respect Retry-After header) |
| 500 | Server Error | Retry with exponential backoff |
| 503 | Unavailable | Fallback to mock OR queue locally |
| 504 | Gateway Timeout | Retry with backoff |

### Retry Strategy
```typescript
const retryConfig = {
  maxRetries: 3,
  initialDelayMs: 100,
  backoffMultiplier: 2.0,
  maxDelayMs: 30000
};

// Backoff sequence: 100ms, 200ms, 400ms, 800ms, 1600ms, 3200ms...
// (capped at 30s between retries)
```

### Non-Retryable Errors
- `400 Bad Request` - Fix request format + retry
- `401 Unauthorized` - Fix credentials + retry
- `403 Forbidden` - Check permissions, don't retry
- `404 Not Found` - Task/Agent doesn't exist, don't retry
- `409 Conflict` - Agent state changed, retry after delay

### Fallback to Mock
If Hermes is unavailable (503/504 for > 5 minutes):
1. Log: "Hermes unavailable, switching to mock"
2. Use `MockHermesAdapter` for new tasks
3. Alert operator
4. Continue accepting tasks
5. Persist tasks to DB for replay when Hermes returns

---

## ⚙️ CONFIGURATION & ENVIRONMENT

### Required Environment Variables
```bash
# Hermes Connection
HERMES_ENDPOINT=grpc://hermes:50051              # or https://hermes.com
HERMES_API_KEY=sk_live_xxxxx                     # Secret (use vault in production)
HERMES_TIMEOUT_MS=30000                          # Request timeout
HERMES_HEARTBEAT_INTERVAL_MS=5000                # How often to check heartbeat
HERMES_HEARTBEAT_TIMEOUT_MS=15000                # Mark offline if no heartbeat

# Retry Policy
HERMES_MAX_RETRIES=3
HERMES_INITIAL_BACKOFF_MS=100
HERMES_MAX_BACKOFF_MS=30000

# Circuit Breaker (optional)
HERMES_CIRCUIT_BREAKER_THRESHOLD=5               # Errors before opening circuit
HERMES_CIRCUIT_BREAKER_TIMEOUT_MS=60000          # Time to retry (half-open)
```

---

## 📊 RATE LIMITS & QUOTAS

**Research Questions:**
- [ ] What are Hermes rate limits? (requests/sec, tasks/day, etc.)
- [ ] How is rate limiting enforced? (per API key, per agent, global)
- [ ] What headers does Hermes use? (X-RateLimit-Remaining, Retry-After, etc.)

**Expected Rate Limit Headers (if applicable):**
```http
X-RateLimit-Limit: 1000           # Requests per minute
X-RateLimit-Remaining: 999        # Remaining requests
X-RateLimit-Reset: 1609459200     # Unix timestamp when limit resets
Retry-After: 60                    # Seconds to wait before retrying
```

**Recommended HVO Behavior:**
1. Track remaining quota
2. Warn when < 20% remaining
3. Queue tasks locally when rate limited
4. Replay queued tasks after rate limit resets

---

## 🔍 MONITORING & OBSERVABILITY

### Metrics to Collect
- Task dispatch success rate
- Event delivery latency
- Heartbeat reception frequency
- Agent offline/online transitions
- Error rates by type
- API response times (p50, p95, p99)

### Logging
- All API calls (request + response)
- Event received + processed
- Errors + retries
- Rate limit status
- Circuit breaker state changes

### Alerting Thresholds
- Hermes error rate > 5%
- Heartbeat latency > 15 seconds
- Rate limit approaching (< 100 requests remaining)
- Circuit breaker open (Hermes unavailable)

---

## 🧪 TESTING STRATEGY

### Mock Hermes for Development
```typescript
class MockHermesClient implements HermesClient {
  async dispatchTask(task): Promise<string> {
    // Return fake task ID
    return `mock-task-${Date.now()}`;
  }

  subscribeEvents(callback) {
    // Simulate events with delays
    setTimeout(() => callback({
      type: "task.progress",
      data: { percent: 50, message: "Mock progress" }
    }), 1000);
  }

  subscribeHeartbeats(agentId, callback) {
    // Simulate heartbeats every 5s
    setInterval(() => callback({
      agent_id: agentId,
      status: "running",
      timestamp: new Date()
    }), 5000);
  }
}
```

### Integration Test Checklist
- [ ] Connect to Hermes (or mock)
- [ ] Dispatch task → get ID back
- [ ] Poll task status
- [ ] Receive events via WebSocket
- [ ] Receive heartbeats from agent
- [ ] Send pause signal → verify task paused
- [ ] Send resume signal → verify task resumed
- [ ] Send cancel signal → verify task cancelled
- [ ] Hermes timeout → fallback to mock
- [ ] Rate limit → queue + retry

---

## 📞 RESEARCH & DECISIONS NEEDED

**Before Sprint 3 starts, clarify with Hermes team:**

1. **Authentication**
   - [ ] What is primary auth method?
   - [ ] How to obtain API key?
   - [ ] Token expiration + refresh flow?

2. **Protocol**
   - [ ] REST, gRPC, or hybrid?
   - [ ] HTTP/2 support?
   - [ ] Compression (gzip, etc.)?

3. **Task Format**
   - [ ] Exact field names for task submission?
   - [ ] Supported task types?
   - [ ] Agent capability list?
   - [ ] Result format (JSON, structured, unstructured)?

4. **Events**
   - [ ] All event types Hermes emits?
   - [ ] Event delivery guarantees (at-most-once, at-least-once)?
   - [ ] Event retention (how long stored)?
   - [ ] Can we replay missed events?

5. **Heartbeat**
   - [ ] Exact interval + format?
   - [ ] Timeout policy?
   - [ ] What metrics included?

6. **Rate Limits**
   - [ ] Limits per API key / per agent / global?
   - [ ] Burst allowance?
   - [ ] Queue behavior when limited?

7. **SLA & Monitoring**
   - [ ] Hermes uptime SLA?
   - [ ] Status page / monitoring endpoint?
   - [ ] Support contact for issues?

8. **Scalability**
   - [ ] Max concurrent tasks per agent?
   - [ ] Max agents per Hermes instance?
   - [ ] Horizontal scaling (multiple Hermes instances)?

---

## 📌 REFERENCES & DOCUMENTS TO CREATE

**This spec references (to be created):**
1. ✅ This document (HERMES_API_SPECIFICATION.md)
2. 🟡 Real Hermes API documentation (from Hermes team)
3. 🟡 Architecture diagram (component + sequence diagrams)
4. 🟡 Error handling guide + examples
5. 🟡 Rate limiting strategy + dashboard
6. 🟡 Monitoring + alerting setup

---

**Status:** DRAFT - Awaiting Hermes API details  
**Next Step:** Research call with Hermes team (Week 1, Day 1-2)  
**Maintained By:** @Kamal (Backend), @planning-team  
**Last Updated:** 2026-10-01
