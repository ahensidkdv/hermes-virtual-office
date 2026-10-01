import { useEffect } from 'react';
import { useOfficeStore } from '../store/office.store';
import { apiService } from '../services/api';

export function useTasks() {
  const setTasks = useOfficeStore(s => s.setTasks);
  const tasks = useOfficeStore(s => s.tasks);

  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const taskList = await apiService.getTasks();
        setTasks(taskList);
      } catch (error) {
        console.error('Failed to fetch tasks:', error);
      }
    };

    fetchTasks();
  }, [setTasks]);

  return Array.from(tasks.values());
}
