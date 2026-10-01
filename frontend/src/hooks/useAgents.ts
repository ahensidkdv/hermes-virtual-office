import { useEffect } from 'react';
import { useOfficeStore } from '../store/office.store';
import { apiService } from '../services/api';

export function useAgents() {
  const setAgents = useOfficeStore(s => s.setAgents);
  const agents = useOfficeStore(s => s.agents);

  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const agentList = await apiService.getAgents();
        setAgents(agentList);
        console.log(`✅ Loaded ${agentList.length} agents`);
      } catch (error) {
        console.error('Failed to fetch agents:', error);
      }
    };

    fetchAgents();
  }, [setAgents]);

  return Array.from(agents.values());
}
