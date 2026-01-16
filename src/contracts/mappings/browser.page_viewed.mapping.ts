/**
 * Graph mapping for browser.page_viewed events
 * Creates WebPage nodes and VISITED relationships
 */
// EventMapping type from suite-contracts

export const browserPageViewedMapping = {
  eventType: 'browser.page_viewed',
  version: '1.0.0',
  description: 'Maps browser page viewed events to WebPage nodes with VISITED relationships',

  nodeWrites: [
    {
      label: 'WebPage',
      mergeKey: {
        property: 'host',
        path: 'payload.host'
      },
      properties: [
        { property: 'host', source: 'payload.host', required: true },
        { property: 'pathHash', source: 'payload.pathHash' },
        { property: 'titleHash', source: 'payload.titleHash' },
        { property: 'title', source: 'payload.title' },
        { property: 'isSecure', source: 'payload.isSecure' },
        { property: 'contentType', source: 'payload.contentType' },
        { property: 'lastViewedAt', source: { path: 'timestampMs', transform: 'toTimestamp' } },
        { property: 'traceId', source: 'traceId' }
      ],
      alias: 'webPage'
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
      type: 'VISITED',
      from: {
        label: 'User',
        keyProperty: 'userId',
        keyPath: 'userId'
      },
      to: {
        label: 'WebPage',
        keyProperty: 'host',
        keyPath: 'payload.host'
      },
      properties: [
        { property: 'viewedAt', source: { path: 'timestampMs', transform: 'toTimestamp' }, required: true },
        { property: 'durationMs', source: { path: 'payload.viewDurationMs', transform: 'toNumber' } },
        { property: 'transitionType', source: 'payload.transitionType' },
        { property: 'tabId', source: 'payload.tabId' },
        { property: 'isNewTab', source: 'payload.isNewTab' },
        { property: 'incognito', source: 'payload.incognito' },
        { property: 'traceId', source: 'traceId' }
      ]
    }
  ]
};
