/**
 * Graph mapping for calendar.event_created events
 * Creates CalendarEvent nodes and relationships to User
 */
// EventMapping type from suite-contracts

export const calendarEventCreatedMapping = {
  eventType: 'calendar.event_created',
  version: '1.0.0',
  description: 'Maps calendar event created events to CalendarEvent nodes',

  nodeWrites: [
    {
      label: 'CalendarEvent',
      mergeKey: {
        property: 'eventId',
        path: 'payload.eventId'
      },
      properties: [
        { property: 'eventId', source: 'payload.eventId', required: true },
        { property: 'title', source: 'payload.title', required: true },
        { property: 'description', source: 'payload.description' },
        { property: 'startTime', source: { path: 'payload.startTime', transform: 'toTimestamp' }, required: true },
        { property: 'endTime', source: { path: 'payload.endTime', transform: 'toTimestamp' }, required: true },
        { property: 'timezone', source: 'payload.timezone' },
        { property: 'isAllDay', source: 'payload.isAllDay' },
        { property: 'location', source: 'payload.location' },
        { property: 'conferenceLink', source: 'payload.conferenceLink' },
        { property: 'conferenceProvider', source: 'payload.conferenceProvider' },
        { property: 'isRecurring', source: 'payload.isRecurring' },
        { property: 'status', source: 'payload.status' },
        { property: 'visibility', source: 'payload.visibility' },
        { property: 'attendeeCount', source: { path: 'payload.attendeeCount', transform: 'toNumber' } },
        { property: 'isOrganizer', source: 'payload.isOrganizer' },
        { property: 'responseStatus', source: 'payload.responseStatus' },
        { property: 'calendarId', source: 'payload.calendarId' },
        { property: 'calendarName', source: 'payload.calendarName' },
        { property: 'createdAt', source: { path: 'timestampMs', transform: 'toTimestamp' } },
        { property: 'traceId', source: 'traceId' }
      ],
      alias: 'calendarEvent'
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
    }
  ],

  relationshipWrites: [
    {
      type: 'CREATED_EVENT',
      from: {
        label: 'User',
        keyProperty: 'userId',
        keyPath: 'userId'
      },
      to: {
        label: 'CalendarEvent',
        keyProperty: 'eventId',
        keyPath: 'payload.eventId'
      },
      properties: [
        { property: 'createdAt', source: { path: 'timestampMs', transform: 'toTimestamp' }, required: true },
        { property: 'isOrganizer', source: 'payload.isOrganizer' },
        { property: 'responseStatus', source: 'payload.responseStatus' },
        { property: 'traceId', source: 'traceId' }
      ]
    }
  ]
};
