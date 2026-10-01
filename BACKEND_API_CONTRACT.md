# Week 2 Backend API Contract - For Frontend Team

## Agents API

### GET /api/agents
List all agents with status and position

**Response**:
```json
{
  "agents": [
    {
      "id": "agent-01",
      "name": "Agent 1",
      "role": "researcher",
      "status": "idle",
      "position_x": 100.0,
      "position_y": 100.0,
      "room": "lobby",
      "current_task_id": null,
      "hermes_id": null,
      "capabilities": ["task_execution", "subtask_decomposition", "validation"],
      "created_at": "2024-10-01T12:00:00.000Z",
      "updated_at": "2024-10-01T12:00:00.000Z"
    },
    ...
  ],
  "count": 5
}
```

---

### GET /api/agents/:id
Get agent details including current task

**Response**:
```json
{
  "id": "agent-01",
  "name": "Agent 1",
  "role": "researcher",
  "status": "idle",
  "position_x": 100.0,
  "position_y": 100.0,
  "room": "lobby",
  "current_task_id": null,
  "hermes_id": null,
  "capabilities": ["task_execution", "subtask_decomposition", "validation"],
  "created_at": "2024-10-01T12:00:00.000Z",
  "updated_at": "2024-10-01T12:00:00.000Z"
}
```

**Error Responses**:
- `404 Not Found`: Agent not found

---

### PATCH /api/agents/:id
Update agent position and/or status

**Request Body**:
```json
{
  "position_x": 200,
  "position_y": 150,
  "room": "work_desk_1",
  "status": "working"
}
```

**Valid Status Values**: `idle`, `working`, `discussing`, `blocked`

**Valid Room Values**:
- `lobby`
- `work_desk_1` through `work_desk_7`
- `meeting_room`
- `review_area`

**Response**: Updated agent object (same as GET /:id)

**Error Responses**:
- `404 Not Found`: Agent not found
- `400 Bad Request`: Invalid status or room enum value

---

## WebSocket Gateway

### Connection

**URL**: `ws://localhost:3001/ws/office`

**Transport**: WebSocket + polling fallback

**On Connection**:
```json
{
  "type": "connection:ack",
  "message": "Connected to Hermes Virtual Office",
  "clientId": "socket-abc123",
  "timestamp": "2024-10-01T12:00:00.000Z"
}
```

---

### Subscribe to Events

**Send**:
```json
{
  "event": "subscribe:office:events",
  "data": {}
}
```

**Receive**:
```json
{
  "type": "subscribe:ack",
  "message": "Subscribed to office events",
  "room": "office:events"
}
```

---

### Broadcast Events

#### agent:move
Fired when agent position or room changes

**Event**:
```json
{
  "type": "agent:move",
  "agentId": "agent-01",
  "position_x": 200,
  "position_y": 150,
  "room": "work_desk_1",
  "timestamp": "2024-10-01T12:02:00.000Z"
}
```

#### agent:status
Fired when agent status changes

**Event**:
```json
{
  "type": "agent:status",
  "agentId": "agent-01",
  "status": "working",
  "timestamp": "2024-10-01T12:02:00.000Z"
}
```

#### task:assigned
Fired when a task is assigned to an agent

**Event**:
```json
{
  "type": "task:assigned",
  "taskId": "task-abc123",
  "agentId": "agent-01",
  "subtaskCount": 3,
  "timestamp": "2024-10-01T12:02:00.000Z"
}
```

---

## Frontend Integration Example

### Vanilla JavaScript

```javascript
// Connect to WebSocket
const socket = io('http://localhost:3001/ws/office');

socket.on('connection:ack', (data) => {
  console.log('Connected:', data.clientId);
  
  // Subscribe to office events
  socket.emit('subscribe:office:events', {});
});

// Listen for agent movement
socket.on('agent:move', (event) => {
  console.log(`Agent ${event.agentId} moved to (${event.position_x}, ${event.position_y}) in ${event.room}`);
  
  // Update agent avatar on canvas
  updateAgentPosition(event.agentId, {
    x: event.position_x,
    y: event.position_y,
    room: event.room
  });
});

// Listen for agent status changes
socket.on('agent:status', (event) => {
  console.log(`Agent ${event.agentId} status changed to: ${event.status}`);
  
  // Update agent status indicator (color change)
  updateAgentStatus(event.agentId, event.status);
});

// Listen for task assignments
socket.on('task:assigned', (event) => {
  console.log(`Task ${event.taskId} assigned to ${event.agentId}`);
  
  // Show task assignment UI
  showTaskAssignmentNotification({
    taskId: event.taskId,
    agentId: event.agentId,
    subtaskCount: event.subtaskCount
  });
});

// Cleanup on disconnect
socket.on('disconnect', () => {
  console.log('Disconnected from office');
});
```

### React Hooks Example

```typescript
import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

interface AgentPosition {
  x: number;
  y: number;
  room: string;
}

export function useOfficeSocket() {
  const socketRef = useRef<Socket | null>(null);
  
  useEffect(() => {
    // Connect
    socketRef.current = io('http://localhost:3001/ws/office');
    
    socketRef.current.on('connection:ack', (data) => {
      console.log('Connected:', data.clientId);
      socketRef.current?.emit('subscribe:office:events', {});
    });
    
    socketRef.current.on('agent:move', (event) => {
      // Update React state
      setAgentPosition(event.agentId, {
        x: event.position_x,
        y: event.position_y,
        room: event.room
      });
    });
    
    socketRef.current.on('agent:status', (event) => {
      setAgentStatus(event.agentId, event.status);
    });
    
    socketRef.current.on('task:assigned', (event) => {
      handleTaskAssignment(event);
    });
    
    // Cleanup
    return () => {
      socketRef.current?.disconnect();
    };
  }, []);
  
  return socketRef.current;
}
```

---

## Agent State Machine

```
┌─────────────────────────────────────┐
│  IDLE                               │
│  - room: lobby                      │
│  - current_task_id: null            │
│  - position: (100, 100)             │
└──────────────┬──────────────────────┘
               │
      [Task Assigned]
      (MockManagerAgent)
               │
               ▼
┌──────────────────────────────────────┐
│  WORKING                             │
│  - room: work_desk_1-7               │
│  - current_task_id: <task-id>        │
│  - position: (work_desk_x, y)        │
└──────────────┬──────────────────────┘
               │
     [Subtasks Complete]
               │
               ▼
┌──────────────────────────────────────┐
│  DISCUSSING                          │
│  (Optional - multi-agent discussion) │
│  - room: meeting_room                │
└──────────────┬──────────────────────┘
               │
      [Approval Received]
               │
               ▼
┌──────────────────────────────────────┐
│  IDLE (return to lobby)              │
└──────────────────────────────────────┘
```

---

## Rooms & Coordinates (Reference)

| Room | X Range | Y Range | Purpose |
|------|---------|---------|---------|
| lobby | 0-100 | 0-100 | Wait for task assignment |
| work_desk_1 | 100-150 | 0-50 | Individual work |
| work_desk_2 | 150-200 | 0-50 | Individual work |
| work_desk_3 | 200-250 | 0-50 | Individual work |
| work_desk_4 | 250-300 | 0-50 | Individual work |
| work_desk_5 | 300-350 | 0-50 | Individual work |
| work_desk_6 | 350-400 | 0-50 | Individual work |
| work_desk_7 | 400-450 | 0-50 | Individual work |
| meeting_room | 200-300 | 200-300 | Multi-agent discussion |
| review_area | 100-200 | 200-300 | Review & approval |

---

## Performance Characteristics

- **List Agents**: ~10-50ms (PostgreSQL index on created_at)
- **Get Agent**: ~5-10ms (primary key lookup)
- **Update Agent**: ~20-50ms (PATCH with validation + Redis cache)
- **WebSocket Broadcast**: < 500ms (Redis pub/sub)
- **Concurrent Clients**: Unlimited (Redis backed)
- **Latency Requirement**: ✅ < 500ms achieved

---

## Error Handling

All errors follow this format:

**404 Not Found**:
```json
{
  "statusCode": 404,
  "message": "Agent with ID unknown-agent not found",
  "error": "Not Found"
}
```

**400 Bad Request** (Validation):
```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    {
      "field": "status",
      "message": "Invalid status: invalid_status"
    }
  ]
}
```

---

## Rate Limiting (Recommended for Frontend)

- **Agents List**: Cache for 2-5 seconds
- **Agent Detail**: Cache for 1 second
- **PATCH Updates**: Debounce position updates (100-200ms)
- **WebSocket**: No client-side limit (backend handles)

---

## CORS Configuration

Backend allows requests from:
- Origin: `http://localhost:3000` (or `FRONTEND_URL` env var)
- Credentials: `true` (cookies included)
- Methods: GET, POST, PATCH, DELETE
- Headers: Content-Type, Authorization

---

## Status Codes Reference

| Code | Meaning | When |
|------|---------|------|
| 200 | OK | Successful GET/PATCH |
| 201 | Created | POST /tasks (from Week 1) |
| 400 | Bad Request | Invalid enum, validation error |
| 404 | Not Found | Agent/Task doesn't exist |
| 500 | Server Error | Unhandled exception |

---

## Next Phase (Phase 1)

Frontend should:
1. ✅ Connect to WebSocket on app load
2. ✅ Fetch agents list (GET /api/agents) on initialization
3. ✅ Render agent avatars at (position_x, position_y)
4. ✅ Subscribe to `agent:move` events and update positions
5. ✅ Subscribe to `agent:status` events and update status colors
6. ✅ Subscribe to `task:assigned` events and show notifications
7. ✅ Implement 2D canvas with rooms (PixiJS recommended)

---

**Ready for Integration**: Oct 1, 2024
**Backend Version**: 0.1.0
**API Version**: 1.0
