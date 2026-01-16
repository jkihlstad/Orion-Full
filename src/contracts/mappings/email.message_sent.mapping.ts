/**
 * Graph mapping for email.message_sent events
 * Creates EmailMessage nodes and SENT_EMAIL relationships
 */
// EventMapping type from suite-contracts

export const emailMessageSentMapping = {
  eventType: 'email.message_sent',
  version: '1.0.0',
  description: 'Maps email message sent events to EmailMessage nodes',

  nodeWrites: [
    {
      label: 'EmailMessage',
      mergeKey: {
        property: 'messageId',
        path: 'payload.messageId'
      },
      properties: [
        { property: 'messageId', source: 'payload.messageId', required: true },
        { property: 'threadId', source: 'payload.threadId' },
        { property: 'subject', source: 'payload.subject' },
        { property: 'subjectHash', source: 'payload.subjectHash' },
        { property: 'fromDomain', source: 'payload.fromDomain' },
        { property: 'recipientCount', source: { path: 'payload.recipientCount', transform: 'toNumber' } },
        { property: 'toCount', source: { path: 'payload.toCount', transform: 'toNumber' } },
        { property: 'ccCount', source: { path: 'payload.ccCount', transform: 'toNumber' } },
        { property: 'bccCount', source: { path: 'payload.bccCount', transform: 'toNumber' } },
        { property: 'hasAttachments', source: 'payload.hasAttachments' },
        { property: 'attachmentCount', source: { path: 'payload.attachmentCount', transform: 'toNumber' } },
        { property: 'totalAttachmentSizeBytes', source: { path: 'payload.totalAttachmentSizeBytes', transform: 'toNumber' } },
        { property: 'bodyLength', source: { path: 'payload.bodyLength', transform: 'toNumber' } },
        { property: 'bodyWordCount', source: { path: 'payload.bodyWordCount', transform: 'toNumber' } },
        { property: 'isReply', source: 'payload.isReply' },
        { property: 'isForward', source: 'payload.isForward' },
        { property: 'inReplyToId', source: 'payload.inReplyToId' },
        { property: 'priority', source: 'payload.priority' },
        { property: 'isEncrypted', source: 'payload.isEncrypted' },
        { property: 'isSigned', source: 'payload.isSigned' },
        { property: 'provider', source: 'payload.provider' },
        { property: 'sentAt', source: { path: 'timestampMs', transform: 'toTimestamp' } },
        { property: 'traceId', source: 'traceId' }
      ],
      alias: 'email'
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
      label: 'EmailThread',
      condition: 'payload.threadId',
      mergeKey: {
        property: 'threadId',
        path: 'payload.threadId'
      },
      properties: [
        { property: 'threadId', source: 'payload.threadId', required: true },
        { property: 'lastMessageAt', source: { path: 'timestampMs', transform: 'toTimestamp' } },
        { property: 'traceId', source: 'traceId' }
      ],
      alias: 'thread'
    }
  ],

  relationshipWrites: [
    {
      type: 'SENT_EMAIL',
      from: {
        label: 'User',
        keyProperty: 'userId',
        keyPath: 'userId'
      },
      to: {
        label: 'EmailMessage',
        keyProperty: 'messageId',
        keyPath: 'payload.messageId'
      },
      properties: [
        { property: 'sentAt', source: { path: 'timestampMs', transform: 'toTimestamp' }, required: true },
        { property: 'provider', source: 'payload.provider' },
        { property: 'traceId', source: 'traceId' }
      ]
    },
    {
      type: 'PART_OF_THREAD',
      condition: 'payload.threadId',
      from: {
        label: 'EmailMessage',
        keyProperty: 'messageId',
        keyPath: 'payload.messageId'
      },
      to: {
        label: 'EmailThread',
        keyProperty: 'threadId',
        keyPath: 'payload.threadId'
      },
      properties: [
        { property: 'addedAt', source: { path: 'timestampMs', transform: 'toTimestamp' }, required: true },
        { property: 'traceId', source: 'traceId' }
      ]
    }
  ]
};
