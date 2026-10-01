import { create } from 'zustand';
import { Agent, Task, AgentStatus, RoomType } from '../types';

interface OfficeStore {
  // State
  agents: Map<string, Agent>;
  tasks: Map<string, Task>;
  selectedAgentId: string | null;
  isDetailPanelOpen: boolean;
  lastUpdateTime: number;
  
  // Actions
  setAgents: (agents: Agent[]) => void;
  updateAgent: (agent: Agent) => void;
  updateAgentPosition: (agentId: string, x: number, y: number, room: RoomType) => void;
  updateAgentStatus: (agentId: string, status: AgentStatus) => void;
  setTasks: (tasks: Task[]) => void;
  addTask: (task: Task) => void;
  setSelectedAgent: (agentId: string | null) => void;
  toggleDetailPanel: () => void;
  closeDetailPanel: () => void;
}

export const useOfficeStore = create<OfficeStore>((set) => ({
  agents: new Map(),
  tasks: new Map(),
  selectedAgentId: null,
  isDetailPanelOpen: false,
  lastUpdateTime: 0,
  
  setAgents: (agents) => set(() => ({
    agents: new Map(agents.map(a => [a.id, a])),
    lastUpdateTime: Date.now()
  })),
  
  updateAgent: (agent) => set((state) => {
    const newAgents = new Map(state.agents);
    newAgents.set(agent.id, agent);
    return { agents: newAgents, lastUpdateTime: Date.now() };
  }),
  
  updateAgentPosition: (agentId, x, y, room) => set((state) => {
    const agent = state.agents.get(agentId);
    if (!agent) return state;
    
    const updated = { ...agent, position_x: x, position_y: y, room };
    const newAgents = new Map(state.agents);
    newAgents.set(agentId, updated);
    return { agents: newAgents, lastUpdateTime: Date.now() };
  }),
  
  updateAgentStatus: (agentId, status) => set((state) => {
    const agent = state.agents.get(agentId);
    if (!agent) return state;
    
    const updated = { ...agent, status };
    const newAgents = new Map(state.agents);
    newAgents.set(agentId, updated);
    return { agents: newAgents, lastUpdateTime: Date.now() };
  }),
  
  setTasks: (tasks) => set(() => ({
    tasks: new Map(tasks.map(t => [t.id, t]))
  })),
  
  addTask: (task) => set((state) => {
    const newTasks = new Map(state.tasks);
    newTasks.set(task.id, task);
    return { tasks: newTasks };
  }),
  
  setSelectedAgent: (agentId) => set(() => ({
    selectedAgentId: agentId,
    isDetailPanelOpen: agentId !== null
  })),
  
  toggleDetailPanel: () => set((state) => ({
    isDetailPanelOpen: !state.isDetailPanelOpen
  })),
  
  closeDetailPanel: () => set(() => ({
    isDetailPanelOpen: false,
    selectedAgentId: null
  }))
}));
