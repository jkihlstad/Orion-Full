/**
 * Graph mapping for tasks.task_created events
 * Creates Task nodes with relationships to User and Project
 */
// EventMapping type from suite-contracts

export const tasksTaskCreatedMapping = {
  eventType: 'tasks.task_created',
  version: '1.0.0',
  description: 'Maps task created events to Task nodes with optional Project relationships',

  nodeWrites: [
    {
      label: 'Task',
      mergeKey: {
        property: 'taskId',
        path: 'payload.taskId'
      },
      properties: [
        { property: 'taskId', source: 'payload.taskId', required: true },
        { property: 'title', source: 'payload.title', required: true },
        { property: 'description', source: 'payload.description' },
        { property: 'priority', source: 'payload.priority' },
        { property: 'dueDate', source: 'payload.dueDate' },
        { property: 'dueTime', source: 'payload.dueTime' },
        { property: 'dueDateTime', source: 'payload.dueDateTime' },
        { property: 'startDate', source: 'payload.startDate' },
        { property: 'estimatedMinutes', source: { path: 'payload.estimatedMinutes', transform: 'toNumber' } },
        { property: 'estimatedPomodoros', source: { path: 'payload.estimatedPomodoros', transform: 'toNumber' } },
        { property: 'isRecurring', source: 'payload.isRecurring' },
        { property: 'recurrenceRule', source: 'payload.recurrenceRule' },
        { property: 'status', source: 'payload.status' },
        { property: 'energy', source: 'payload.energy' },
        { property: 'context', source: 'payload.context' },
        { property: 'source', source: 'payload.source' },
        { property: 'parentTaskId', source: 'payload.parentTaskId' },
        { property: 'projectId', source: 'payload.projectId' },
        { property: 'createdAt', source: { path: 'timestampMs', transform: 'toTimestamp' } },
        { property: 'traceId', source: 'traceId' }
      ],
      alias: 'task'
    },
    {
      label: 'User',
      mergeKey: {
        property: 'userId',
        path: 'userId'
      },
      properties: [
        { property: 'userId', source: 'userId', required: true }
      ],
      alias: 'user'
    },
    {
      label: 'Project',
      condition: 'payload.projectId',
      mergeKey: {
        property: 'projectId',
        path: 'payload.projectId'
      },
      properties: [
        { property: 'projectId', source: 'payload.projectId', required: true },
        { property: 'name', source: 'payload.project' },
        { property: 'lastTaskAt', source: { path: 'timestampMs', transform: 'toTimestamp' } },
        { property: 'traceId', source: 'traceId' }
      ],
      alias: 'project'
    }
  ],

  relationshipWrites: [
    {
      type: 'CREATED_TASK',
      from: {
        label: 'User',
        keyProperty: 'userId',
        keyPath: 'userId'
      },
      to: {
        label: 'Task',
        keyProperty: 'taskId',
        keyPath: 'payload.taskId'
      },
      properties: [
        { property: 'createdAt', source: { path: 'timestampMs', transform: 'toTimestamp' }, required: true },
        { property: 'source', source: 'payload.source' },
        { property: 'traceId', source: 'traceId' }
      ]
    },
    {
      type: 'IN_PROJECT',
      condition: 'payload.projectId',
      from: {
        label: 'Task',
        keyProperty: 'taskId',
        keyPath: 'payload.taskId'
      },
      to: {
        label: 'Project',
        keyProperty: 'projectId',
        keyPath: 'payload.projectId'
      },
      properties: [
        { property: 'addedAt', source: { path: 'timestampMs', transform: 'toTimestamp' }, required: true },
        { property: 'traceId', source: 'traceId' }
      ]
    },
    {
      type: 'SUBTASK_OF',
      condition: 'payload.parentTaskId',
      from: {
        label: 'Task',
        keyProperty: 'taskId',
        keyPath: 'payload.taskId'
      },
      to: {
        label: 'Task',
        keyProperty: 'taskId',
        keyPath: 'payload.parentTaskId'
      },
      properties: [
        { property: 'linkedAt', source: { path: 'timestampMs', transform: 'toTimestamp' }, required: true },
        { property: 'traceId', source: 'traceId' }
      ]
    }
  ]
};
