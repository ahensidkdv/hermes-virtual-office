# Phase 1 Planning: Frontend 2D Visualization (Sprint 2: Oct 15-29)

**Version:** 1.0  
**Date:** 2026-10-01  
**Sprint:** 2 (Oct 15-29, 2 weeks)  
**Phase:** 1 - Core Loop (Fixed 2D Map + Real-Time Avatar Movement)  
**Status:** PLANNING

---

## 🎯 PHASE 1 GOAL

Deliver a working 2D virtual office where:
1. **User creates task** → Task input form (React)
2. **Backend decomposes** → MockManagerAgent creates subtasks
3. **Agent auto-assigned** → PATCH /api/agents updates position
4. **Real-time sync** → WebSocket broadcasts agent:move, agent:status
5. **Frontend renders** → PixiJS canvas shows agent avatars moving in real office layout
6. **User observes** → See task flow through office (Lobby → Work Desk → Review Area → Done)

**Success Metric:** < 3 second cold load, < 500ms position update latency

---

## 📋 USER STORIES (Phase 1)

**US-VO-01: Rendering Virtual Office 2D Fixed Layout** (Phase 1, Week 1)
- Operator opens app → sees fixed 2D office map (Lobby, Work Desks 1-7, Meeting Room, Review Area)
- Map is proportional, responsive (1366x768 min)
- Visual clarity: room boundaries, agent positions, status indicators

**US-VO-02: Real-Time Avatar Movement & Status** (Phase 1, Week 1-2)
- Avatar moves smoothly from A to B (2-3 sec, interpolated)
- Status badge shows: idle (blue), working (green), discussing (yellow), blocked (red)
- Update latency < 500ms
- Smooth animation (no jank, 60fps target)

**US-VO-03: Drill-Down Detail Panel** (Phase 1, Week 2)
- Click avatar → side panel shows:
  - Agent name, role, Hermes ID
  - Current task + status
  - Recent activity log
  - Quick actions (pause, cancel, inject context)

**US-TM-01 Frontend: Task Input Form** (Phase 1, Week 2)
- Input: title (min 10 chars), priority (low/medium/high/critical)
- Submit → POST /api/tasks
- Feedback: success notification, task ID shown
- Validation: show inline errors

---

## 🏗️ ARCHITECTURE (Frontend)

```
Frontend Structure:
├── pages/
│   └── Office.tsx              # Main office view
├── components/
│   ├── OfficeCanvas.tsx        # PixiJS canvas wrapper
│   ├── AgentAvatar.tsx         # Avatar sprite + animation (container)
│   ├── DetailPanel.tsx         # Agent detail drill-down
│   ├── TaskInputForm.tsx       # Task creation form
│   ├── Dashboard.tsx           # Metrics (active agents, tasks)
│   └── ActivityFeed.tsx        # Real-time log (nice-to-have)
├── hooks/
│   ├── useWebSocket.ts         # Connect to /ws/office
│   ├── useAgents.ts            # GET /api/agents + caching
│   ├── useTasks.ts             # GET /api/tasks + caching
│   └── useOfficeState.ts       # Zustand store (positions, status)
├── services/
│   ├── api.ts                  # HTTP client (axios)
│   ├── websocket.ts            # WebSocket client (socket.io-client)
│   └── pixijs-renderer.ts      # PixiJS setup + rendering
├── types/
│   └── index.ts                # Agent, Task, Event interfaces
├── store/
│   └── office.store.ts         # Zustand: agent positions, UI state
└── styles/
    └── index.css               # Tailwind + custom CSS
```

---

## 🎨 VISUAL DESIGN

### Office Layout (1366x768)

```
┌─────────────────────────────────────────────────────────────────┐
│  HERMES VIRTUAL OFFICE                              [Menu]     │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                           │   │
│  │        LOBBY              MEETING ROOM      REVIEW       │   │
│  │      (Idle agents)       (Discussion)       AREA         │   │
│  │                                                           │   │
│  │   ┌─────┐    ┌─────┐              ┌─────┐  ┌─────┐    │   │
│  │   │ WD1 │    │ WD2 │              │ MR  │  │ RA  │    │   │
│  │   │  🧑 │    │  🧑 │              │  🧑 │  │  🧑 │    │   │
│  │   └─────┘    └─────┘              └─────┘  └─────┘    │   │
│  │                                                           │   │
│  │   ┌─────┐    ┌─────┐     ┌─────┐  ┌─────┐  ┌─────┐    │   │
│  │   │ WD3 │    │ WD4 │     │ WD5 │  │ WD6 │  │ WD7 │    │   │
│  │   │     │    │  🧑 │     │     │  │     │  │     │    │   │
│  │   └─────┘    └─────┘     └─────┘  └─────┘  └─────┘    │   │
│  │                                                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                   │
├─────────────────────────────────────────────────────────────────┤
│ Status: 5 agents active | 2 tasks in progress | Uptime: 2h 15m │
└─────────────────────────────────────────────────────────────────┘
```

### Rooms
- **Lobby (120x80px):** 2-3 idle agents, spawn point
- **Work Desks 1-7 (60x80px each):** Active agents working on tasks
- **Meeting Room (80x80px):** Agents discussing/collaborating
- **Review Area (100x80px):** Agents waiting for operator approval

### Avatar Indicators
- **Circle sprite** (32px diameter) with agent name below
- **Status badge** (top-right corner):
  - Blue = idle (in Lobby)
  - Green = working (in Work Desk)
  - Yellow = discussing (in Meeting Room)
  - Red = blocked/error (anywhere)
- **Hover:** Show agent name + role tooltip

---

## 📦 TECH STACK (Frontend Phase 1)

| Layer | Tech | Version |
|-------|------|---------|
| **Framework** | React | 18.2+ |
| **Build** | Vite | 5.0+ |
| **Language** | TypeScript | 5.0+ |
| **2D Rendering** | PixiJS | 8.x |
| **Animation** | @tweenjs/tween | 23.x |
| **State** | Zustand | 4.x |
| **HTTP** | Axios | 1.x |
| **WebSocket** | socket.io-client | 4.x |
| **Styling** | Tailwind CSS | 3.x |
| **Validation** | Zod | 3.x |

---

## 🎬 DEVELOPMENT PHASES (Week 1-2)

### WEEK 1: Core Rendering + Real-Time Sync (Oct 15-22)

#### Day 1 (Mon): Project Setup
- [ ] Init React + Vite project (`npm create vite@latest hvo-frontend -- --template react-ts`)
- [ ] Setup Tailwind CSS
- [ ] Add dependencies: PixiJS, Zustand, Socket.IO, Axios, Tween.js
- [ ] Create folder structure + Dockerize
- [ ] GIT: initial commit

#### Day 2-3 (Tue-Wed): PixiJS Canvas + Office Layout
- [ ] Create `OfficeCanvas` component (wrapper around PixiJS app)
- [ ] Render fixed office layout (4 rooms, 7 work desks)
- [ ] Render room boundaries (rectangles)
- [ ] Test: Room coordinates match backend (x, y, room names)
- [ ] Add background + grid (optional)

#### Day 4 (Thu): Agent Avatars + Initial Positioning
- [ ] Create Agent avatar sprite (circle + name label)
- [ ] Fetch agents from `/api/agents`
- [ ] Position avatars based on agent position (x, y)
- [ ] Add status badge (color = status)
- [ ] Test: 5 avatars render in correct positions

#### Day 5 (Fri): WebSocket Connection + Real-Time Updates
- [ ] Connect to `ws://localhost:3001/ws/office`
- [ ] Listen to `agent:move` events
- [ ] Update agent position in Zustand store
- [ ] Trigger PixiJS re-render on position change
- [ ] Test: Move agent via PATCH /api/agents → see avatar move in real-time

**Week 1 Deliverable:** Static office + agent avatars + real-time position sync

---

### WEEK 2: Animation + Interaction + Task Form (Oct 22-29)

#### Day 1 (Mon): Avatar Animation
- [ ] Implement smooth movement (Tween.js, 2-3 sec duration)
- [ ] Easing function: Quadratic.InOut (smooth)
- [ ] Test: Avatar moves from desk 1 → desk 5 smoothly
- [ ] Measure latency: target < 500ms

#### Day 2 (Tue): Status Badge + Visual Feedback
- [ ] Implement status badge colors (idle/working/discussing/blocked)
- [ ] Add badge animations (pulse when blocked)
- [ ] Implement hover tooltip (agent name + role)
- [ ] Test: Update agent status → see badge change color

#### Day 3 (Wed): Detail Panel (Drill-Down)
- [ ] Create `DetailPanel` component (right side)
- [ ] Click avatar → toggle panel open
- [ ] Show: agent name, role, current task, status, logs
- [ ] Add close button + panel close on click outside
- [ ] Test: Click avatar → panel shows + click outside → closes

#### Day 4 (Thu): Task Input Form
- [ ] Create `TaskInputForm` component (top-right)
- [ ] Fields: title (text), priority (select)
- [ ] Validation: title min 10 chars
- [ ] Submit: POST /api/tasks
- [ ] Feedback: show success message + task ID
- [ ] Test: Submit form → task created → manager agent decomposes → agent assigned → avatar moves

#### Day 5 (Fri): Polish + E2E Testing
- [ ] Responsive design (1366x768 min)
- [ ] Dark mode (optional)
- [ ] Activity feed (show recent events)
- [ ] Dashboard metrics (# agents, # tasks)
- [ ] E2E: full workflow (form → decompose → assign → move → review)

**Week 2 Deliverable:** Fully interactive frontend with task creation + real-time agent movement

---

## 📐 COMPONENT DETAILS

### OfficeCanvas (PixiJS Wrapper)
```typescript
interface OfficeCanvasProps {
  agents: Agent[];
  selectedAgentId: string | null;
  onAgentClick: (agentId: string) => void;
}

// Render PixiJS stage
// Listen to WebSocket updates
// Update avatar positions + status
// Handle click events
```

### AgentAvatar
```typescript
interface AvatarProps {
  agent: Agent;
  isSelected: boolean;
  onClick: () => void;
}

// Render sprite circle (colored by status)
// Show agent name below
// Status badge (top-right)
// Animate movement
// Show tooltip on hover
```

### DetailPanel
```typescript
interface DetailPanelProps {
  agent: Agent | null;
  task: Task | null;
  isOpen: boolean;
  onClose: () => void;
}

// Show agent info
// Show current task + subtasks
// Show activity log
// Quick action buttons (pause, cancel, inject)
```

### TaskInputForm
```typescript
interface TaskInputFormProps {
  onSubmit: (title: string, priority: string) => void;
  isLoading: boolean;
}

// Title input (min 10 chars validation)
// Priority select (low/medium/high/critical)
// Submit button
// Error messages
// Success notification
```

---

## 🔗 API INTEGRATION

### GET /api/agents
```typescript
// Fetch on app load
const agents = await api.get('/api/agents');
// Store in Zustand: agents state
```

### PATCH /api/agents/:id (Backend does this)
```typescript
// Update agent position when task assigned
// Frontend listens to WebSocket for response
```

### POST /api/tasks
```typescript
// User submits form
await api.post('/api/tasks', { title, priority });
// Wait for task.created event via WebSocket
```

### WebSocket /ws/office
```typescript
// Listen events:
socket.on('agent:move', (data) => {
  // Update agent position in store
  // Re-render avatar
});

socket.on('agent:status', (data) => {
  // Update agent status
  // Re-render badge
});

socket.on('task:assigned', (data) => {
  // Update agent task
  // Refresh detail panel if open
});
```

---

## 🧪 TESTING STRATEGY

### Unit Tests
- [ ] Agent avatar positioning calculation
- [ ] Room coordinate mapping
- [ ] Validation logic (form)
- [ ] Zustand store mutations

### E2E Tests (Playwright)
1. Load app → see 5 agents in Lobby
2. Submit task form → task created
3. Manager agent decomposes (wait 2s)
4. Agent assigned → avatar moves to work desk (verify position)
5. Verify WebSocket broadcast received
6. Click avatar → detail panel opens
7. Close panel → click outside

### Performance Tests
- [ ] Cold load < 3 seconds
- [ ] Agent position update < 500ms
- [ ] 60fps animation (no jank)
- [ ] Memory: no leaks on reconnect

---

## 📊 SUCCESS METRICS (End of Phase 1)

| Metric | Target | How to Verify |
|--------|--------|---------------|
| Load time | < 3s | lighthouse |
| Position update latency | < 500ms | timestamp in console |
| Animation smoothness | 60fps | Chrome DevTools |
| Avatar count | 5 active | visual inspection |
| Room accuracy | 100% | position logging |
| WebSocket uptime | 99.9% | connection logs |
| Form validation | 100% | unit tests |
| Responsive | 1366x768 min | browser resize |

---

## 🚀 DEPLOYMENT (Phase 1 End)

### Docker Setup
```dockerfile
# frontend/Dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
```

### docker-compose.yml Update
```yaml
frontend:
  build: ./frontend
  ports:
    - "3000:3000"
  environment:
    VITE_API_URL: http://localhost:3001
    VITE_WS_URL: ws://localhost:3001
  depends_on:
    - backend
```

---

## 📅 TIMELINE

```
Sprint 2 (Phase 1): Oct 15-29
├── Week 1 (Oct 15-22)
│   ├── Mon: Project setup + folder structure
│   ├── Tue-Wed: PixiJS canvas + office layout
│   ├── Thu: Agent avatars + positioning
│   ├── Fri: WebSocket connection
│   └── Deliverable: Static office + real-time sync
│
├── Week 2 (Oct 22-29)
│   ├── Mon: Avatar animation
│   ├── Tue: Status badges + visual feedback
│   ├── Wed: Detail panel drill-down
│   ├── Thu: Task input form
│   ├── Fri: Polish + E2E testing
│   └── Deliverable: Fully interactive frontend
│
└── Sprint Review (Oct 29)
    ├── Demo: Full workflow (task → assign → move)
    ├── Test results: unit + E2E
    └── Planning: Sprint 3 (Phase 2 - Real Hermes)
```

---

## 🎯 SPRINT 2 TEAM

**Role:** Frontend Developer (1 person or team)
**Skills:** React, TypeScript, PixiJS (or canvas), WebSocket
**Backend Support:** Kamal (available for API/integration questions)

---

## 📝 NEXT STEPS

1. **TODAY:** Approval on Phase 1 plan
2. **Tomorrow (Oct 2):** Start project setup + Kamal fixes backend
3. **Oct 15 (Sprint 2 start):** Frontend dev kicks off

---

**Status:** Ready for Sprint 2 Planning Session

**Questions/Feedback?** Comment in Discord or create GitHub issue
