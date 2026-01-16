/**
 * Graph mapping for finance.transaction_created events
 * Creates Transaction and Merchant nodes with relationships
 */
// EventMapping type from suite-contracts

export const financeTransactionCreatedMapping = {
  eventType: 'finance.transaction_created',
  version: '1.0.0',
  description: 'Maps financial transaction events to Transaction and Merchant nodes',

  nodeWrites: [
    {
      label: 'Transaction',
      mergeKey: {
        property: 'transactionId',
        path: 'payload.transactionId'
      },
      properties: [
        { property: 'transactionId', source: 'payload.transactionId', required: true },
        { property: 'amount', source: { path: 'payload.amount', transform: 'toNumber' }, required: true },
        { property: 'currency', source: 'payload.currency', required: true },
        { property: 'category', source: 'payload.category' },
        { property: 'subcategory', source: 'payload.subcategory' },
        { property: 'pending', source: 'payload.pending' },
        { property: 'transactionDate', source: 'payload.transactionDate' },
        { property: 'authorizedDate', source: 'payload.authorizedDate' },
        { property: 'transactionType', source: 'payload.transactionType' },
        { property: 'paymentChannel', source: 'payload.paymentChannel' },
        { property: 'accountRef', source: 'payload.accountRef' },
        { property: 'locationCity', source: 'payload.location.city' },
        { property: 'locationRegion', source: 'payload.location.region' },
        { property: 'locationCountry', source: 'payload.location.country' },
        { property: 'createdAt', source: { path: 'timestampMs', transform: 'toTimestamp' } },
        { property: 'traceId', source: 'traceId' }
      ],
      alias: 'transaction'
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
      label: 'Merchant',
      condition: 'payload.merchant',
      mergeKey: {
        property: 'name',
        path: 'payload.merchantNormalized'
      },
      properties: [
        { property: 'name', source: 'payload.merchantNormalized', required: true },
        { property: 'displayName', source: 'payload.merchant' },
        { property: 'category', source: 'payload.category' },
        { property: 'subcategory', source: 'payload.subcategory' },
        { property: 'lastTransactionAt', source: { path: 'timestampMs', transform: 'toTimestamp' } },
        { property: 'traceId', source: 'traceId' }
      ],
      alias: 'merchant'
    }
  ],

  relationshipWrites: [
    {
      type: 'MADE_TRANSACTION',
      from: {
        label: 'User',
        keyProperty: 'userId',
        keyPath: 'userId'
      },
      to: {
        label: 'Transaction',
        keyProperty: 'transactionId',
        keyPath: 'payload.transactionId'
      },
      properties: [
        { property: 'transactedAt', source: { path: 'timestampMs', transform: 'toTimestamp' }, required: true },
        { property: 'amount', source: { path: 'payload.amount', transform: 'toNumber' } },
        { property: 'currency', source: 'payload.currency' },
        { property: 'traceId', source: 'traceId' }
      ]
    },
    {
      type: 'AT_MERCHANT',
      condition: 'payload.merchant',
      from: {
        label: 'Transaction',
        keyProperty: 'transactionId',
        keyPath: 'payload.transactionId'
      },
      to: {
        label: 'Merchant',
        keyProperty: 'name',
        keyPath: 'payload.merchantNormalized'
      },
      properties: [
        { property: 'transactedAt', source: { path: 'timestampMs', transform: 'toTimestamp' }, required: true },
        { property: 'traceId', source: 'traceId' }
      ]
    },
    {
      type: 'SPENT_AT',
      condition: 'payload.merchant',
      from: {
        label: 'User',
        keyProperty: 'userId',
        keyPath: 'userId'
      },
      to: {
        label: 'Merchant',
        keyProperty: 'name',
        keyPath: 'payload.merchantNormalized'
      },
      properties: [
        { property: 'lastSpentAt', source: { path: 'timestampMs', transform: 'toTimestamp' }, required: true },
        { property: 'traceId', source: 'traceId' }
      ]
    }
  ]
};
