import React, { useState } from 'react';
import { apiService } from '../services/api';

interface TaskInputFormProps {
  onTaskCreated?: (taskId: string) => void;
}

export const TaskInputForm: React.FC<TaskInputFormProps> = ({ onTaskCreated }) => {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('medium');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (title.length < 10) {
      setError('Title must be at least 10 characters');
      return;
    }

    setIsLoading(true);
    try {
      const task = await apiService.createTask(title, priority);
      setSuccess(`✅ Task created: ${task.id}`);
      setTitle('');
      setPriority('medium');
      onTaskCreated?.(task.id);
    } catch (err) {
      setError(`Failed to create task: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full bg-gray-800 p-6 rounded-lg border border-gray-700">
      <h2 className="text-xl font-bold mb-4 text-white">Create Task</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Title {title.length < 10 && <span className="text-red-500">*</span>}
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter task title (min 10 chars)"
            className="w-full px-4 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
          />
          {title.length > 0 && title.length < 10 && (
            <p className="text-red-500 text-xs mt-1">{10 - title.length} chars remaining</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Priority</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="w-full px-4 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>

        {error && <div className="text-red-500 text-sm">{error}</div>}
        {success && <div className="text-green-500 text-sm">{success}</div>}

        <button
          type="submit"
          disabled={isLoading || title.length < 10}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {isLoading ? '⏳ Creating...' : '✨ Create Task'}
        </button>
      </form>
    </div>
  );
};
