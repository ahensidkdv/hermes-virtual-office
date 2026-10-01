import axios from 'axios';
import { Agent, Task } from '../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const client = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

export const apiService = {
  // Agents
  async getAgents(): Promise<Agent[]> {
    const response = await client.get('/api/agents');
    return response.data.agents || [];
  },

  async getAgent(id: string): Promise<Agent> {
    const response = await client.get(`/api/agents/${id}`);
    return response.data;
  },

  async updateAgent(id: string, updates: Partial<Agent>): Promise<Agent> {
    const response = await client.patch(`/api/agents/${id}`, updates);
    return response.data;
  },

  // Tasks
  async getTasks(): Promise<Task[]> {
    const response = await client.get('/api/tasks');
    return response.data.tasks || [];
  },

  async createTask(title: string, priority: string): Promise<Task> {
    const response = await client.post('/api/tasks', { title, priority });
    return response.data;
  }
};
