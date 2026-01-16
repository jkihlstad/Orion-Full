/// <reference types="@cloudflare/workers-types" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  d1InsertEvent,
  d1InsertEventWithTrace,
  d1GetEventById,
  d1GetEventsByTraceId,
  d1ListEventsForUser,
  d1CountUserEvents7d,
  d1ListEventsFiltered,
  d1InsertEventWithDedupe,
  d1InsertEventsBatch,
  d1UpsertIdempotency,
  d1MarkConvexDelivery,
  d1MarkConvexDeliverySimple,
  d1MarkSocialDelivery,
  d1MarkSocialDeliverySimple,
  d1SkipSocialDelivery,
  d1GetFailedDeliveries,
  d1GetPendingDeliveries,
  d1GetConsent,
  d1SetConsent,
  d1ListConsents,
  d1GetUserConsents,
  d1SetUserConsents,
  d1CheckUserConsent,
  d1CheckUserConsents,
  d1Audit,
  d1InsertEventBlobs,
  d1GetEventBlobs,
  d1GetEventsByBlobKey,
  d1CountUserBlobs,
  d1GetReferencedBlobKeys,
  d1UpsertProfileSnapshot,
  d1GetProfileSnapshot,
  d1ListProfileSnapshots,
  d1GetAvatarSnapshot,
  d1GetAppSnapshots,
  d1GetRecentEvents,
  DeliveryResult,
  BlobRefRow,
  ProfileSnapshotRow,
} from './d1';
import { Env } from '../env';
import { EventEnvelopeT } from '../types';

// Helper to create a mock D1 statement
function createMockStatement(overrides?: {
  run?: ReturnType<typeof vi.fn>;
  first?: ReturnType<typeof vi.fn>;
  all?: ReturnType<typeof vi.fn>;
}) {
  const statement = {
    bind: vi.fn().mockReturnThis(),
    run: overrides?.run ?? vi.fn().mockResolvedValue({ success: true }),
    first: overrides?.first ?? vi.fn().mockResolvedValue(null),
    all: overrides?.all ?? vi.fn().mockResolvedValue({ results: [] }),
  };
  return statement;
}

// Helper to create a mock Env with D1
function createMockEnv(statementOverrides?: Parameters<typeof createMockStatement>[0]): Env {
  const mockStatement = createMockStatement(statementOverrides);
  return {
    DB: {
      prepare: vi.fn().mockReturnValue(mockStatement),
    } as unknown as D1Database,
    BLOBS: {} as R2Bucket,
    KV: {} as KVNamespace,
    FANOUT_QUEUE: {} as Queue,
    ENVIRONMENT: 'test',
    CLERK_ISSUER: 'test-issuer',
    CLERK_JWKS_URL: 'https://test.clerk.dev/.well-known/jwks.json',
    CONVEX_INGEST_URL: 'https://test.convex.dev',
    R2_ACCOUNT_ID: 'test-account',
    R2_BUCKET_NAME: 'test-bucket',
    R2_S3_ACCESS_KEY_ID: 'test-key',
    R2_S3_SECRET_ACCESS_KEY: 'test-secret',
  };
}

// Helper to create a sample event envelope
function createSampleEvent(overrides?: Partial<EventEnvelopeT>): EventEnvelopeT {
  return {
    eventId: 'evt-12345678',
    userId: 'user-123',
    sourceApp: 'finance',
    eventType: 'finance.transaction',
    timestamp: 1700000000000,
    privacyScope: 'private',
    consentScope: 'finance.transactions',
    consentVersion: '1.0',
    idempotencyKey: 'idem-12345678',
    payload: { amount: 100, currency: 'USD' },
    ...overrides,
  };
}

describe('D1 Storage Layer', () => {
  let mockEnv: Env;
  let originalDateNow: typeof Date.now;

  beforeEach(() => {
    originalDateNow = Date.now;
    Date.now = vi.fn().mockReturnValue(1700000000000);
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('12345678-1234-1234-1234-123456789abc' as `${string}-${string}-${string}-${string}-${string}`);
  });

  afterEach(() => {
    Date.now = originalDateNow;
    vi.restoreAllMocks();
  });

  // ============================================================================
  // Event Insertion Tests
  // ============================================================================

  describe('d1InsertEvent', () => {
    it('should insert an event successfully with all fields', async () => {
      mockEnv = createMockEnv();
      const event = createSampleEvent();
      const row = {
        event,
        payloadJson: JSON.stringify(event.payload),
        blobRefsJson: null,
      };

      await d1InsertEvent(mockEnv, row);

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO events'));
      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith(
        event.eventId,
        event.userId,
        event.sourceApp,
        event.eventType,
        event.timestamp,
        event.privacyScope,
        event.consentScope,
        event.consentVersion,
        event.idempotencyKey,
        row.payloadJson,
        row.blobRefsJson,
        1700000000000
      );
      expect(statement.run).toHaveBeenCalled();
    });

    it('should handle null consentScope', async () => {
      mockEnv = createMockEnv();
      const event = createSampleEvent({ consentScope: undefined });
      const row = {
        event,
        payloadJson: JSON.stringify(event.payload),
        blobRefsJson: null,
      };

      await d1InsertEvent(mockEnv, row);

      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      // Verify that the 7th argument (index 6) is null for consentScope
      const bindArgs = statement.bind.mock.calls[0];
      expect(bindArgs[6]).toBeNull();
    });

    it('should include blob references when provided', async () => {
      mockEnv = createMockEnv();
      const event = createSampleEvent();
      const blobRefs = [{ r2Key: 'blob-123', contentType: 'image/png', sizeBytes: 1024 }];
      const row = {
        event,
        payloadJson: JSON.stringify(event.payload),
        blobRefsJson: JSON.stringify(blobRefs),
      };

      await d1InsertEvent(mockEnv, row);

      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        JSON.stringify(blobRefs),
        expect.anything()
      );
    });
  });

  describe('d1InsertEventWithTrace', () => {
    it('should insert an event with traceId', async () => {
      mockEnv = createMockEnv();
      const event = createSampleEvent();
      const traceId = 'trace-abc123';
      const row = {
        event,
        payloadJson: JSON.stringify(event.payload),
        blobRefsJson: null,
        traceId,
      };

      await d1InsertEventWithTrace(mockEnv, row);

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('traceId'));
      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith(
        event.eventId,
        event.userId,
        event.sourceApp,
        event.eventType,
        event.timestamp,
        event.privacyScope,
        event.consentScope,
        event.consentVersion,
        event.idempotencyKey,
        row.payloadJson,
        row.blobRefsJson,
        1700000000000,
        traceId
      );
    });
  });

  // ============================================================================
  // Event Retrieval Tests
  // ============================================================================

  describe('d1GetEventById', () => {
    it('should retrieve an event by ID without user filter (admin query)', async () => {
      const mockEvent = { id: 'evt-123', userId: 'user-123', eventType: 'test' };
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue(mockEvent),
      });

      const result = await d1GetEventById(mockEnv, 'evt-123');

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(
        'SELECT * FROM events WHERE id = ?'
      );
      expect(result).toEqual(mockEvent);
    });

    it('should retrieve an event by ID with user filter (user query)', async () => {
      const mockEvent = { id: 'evt-123', userId: 'user-123', eventType: 'test' };
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue(mockEvent),
      });

      const result = await d1GetEventById(mockEnv, 'evt-123', 'user-123');

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(
        'SELECT * FROM events WHERE id = ? AND userId = ?'
      );
      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith('evt-123', 'user-123');
      expect(result).toEqual(mockEvent);
    });

    it('should return null when event is not found', async () => {
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue(null),
      });

      const result = await d1GetEventById(mockEnv, 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('d1GetEventsByTraceId', () => {
    it('should retrieve events by traceId without user filter', async () => {
      const mockEvents = [
        { id: 'evt-1', traceId: 'trace-123' },
        { id: 'evt-2', traceId: 'trace-123' },
      ];
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: mockEvents }),
      });

      const result = await d1GetEventsByTraceId(mockEnv, 'trace-123');

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE traceId = ?')
      );
      expect(result).toEqual(mockEvents);
    });

    it('should retrieve events by traceId with user filter', async () => {
      const mockEvents = [{ id: 'evt-1', traceId: 'trace-123', userId: 'user-123' }];
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: mockEvents }),
      });

      const result = await d1GetEventsByTraceId(mockEnv, 'trace-123', 'user-123');

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE traceId = ? AND userId = ?')
      );
      expect(result).toEqual(mockEvents);
    });

    it('should respect the limit parameter', async () => {
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: [] }),
      });

      await d1GetEventsByTraceId(mockEnv, 'trace-123', undefined, 50);

      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith('trace-123', 50);
    });

    it('should use default limit of 100', async () => {
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: [] }),
      });

      await d1GetEventsByTraceId(mockEnv, 'trace-123');

      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith('trace-123', 100);
    });
  });

  describe('d1ListEventsForUser', () => {
    it('should list events for a user without time filter', async () => {
      const mockEvents = [{ id: 'evt-1' }, { id: 'evt-2' }];
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: mockEvents }),
      });

      const result = await d1ListEventsForUser(mockEnv, 'user-123', null, 50);

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(
        'SELECT * FROM events WHERE userId = ? ORDER BY timestampMs DESC LIMIT ?'
      );
      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith('user-123', 50);
      expect(result).toEqual(mockEvents);
    });

    it('should list events for a user with time filter', async () => {
      const mockEvents = [{ id: 'evt-1' }];
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: mockEvents }),
      });

      const sinceMs = 1699000000000;
      const result = await d1ListEventsForUser(mockEnv, 'user-123', sinceMs, 50);

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(
        'SELECT * FROM events WHERE userId = ? AND timestampMs >= ? ORDER BY timestampMs DESC LIMIT ?'
      );
      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith('user-123', sinceMs, 50);
      expect(result).toEqual(mockEvents);
    });

    it('should return empty array when no events found', async () => {
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: undefined }),
      });

      const result = await d1ListEventsForUser(mockEnv, 'user-123', null, 50);

      expect(result).toEqual([]);
    });
  });

  describe('d1CountUserEvents7d', () => {
    it('should count user events in the last 7 days', async () => {
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue({ c: 42 }),
      });

      const result = await d1CountUserEvents7d(mockEnv, 'user-123');

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(
        expect.stringContaining('COUNT(1)')
      );
      expect(result).toBe(42);
    });

    it('should return 0 when no events found', async () => {
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue(null),
      });

      const result = await d1CountUserEvents7d(mockEnv, 'user-123');

      expect(result).toBe(0);
    });

    it('should calculate correct timestamp for 7 days ago', async () => {
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue({ c: 0 }),
      });

      await d1CountUserEvents7d(mockEnv, 'user-123');

      const expectedSince = 1700000000000 - 7 * 24 * 60 * 60 * 1000;
      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith('user-123', expectedSince);
    });
  });

  describe('d1ListEventsFiltered', () => {
    it('should list events without any filters', async () => {
      const mockEvents = [{ id: 'evt-1' }];
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: mockEvents }),
      });

      const result = await d1ListEventsFiltered(mockEnv, { limit: 100 });

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('FROM events'));
      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.not.stringContaining('WHERE'));
      expect(result).toEqual(mockEvents);
    });

    it('should filter by eventType', async () => {
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: [] }),
      });

      await d1ListEventsFiltered(mockEnv, { eventType: 'finance.transaction', limit: 100 });

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('eventType = ?'));
    });

    it('should filter by userId', async () => {
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: [] }),
      });

      await d1ListEventsFiltered(mockEnv, { userId: 'user-123', limit: 100 });

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('userId = ?'));
    });

    it('should filter by sinceMs', async () => {
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: [] }),
      });

      await d1ListEventsFiltered(mockEnv, { sinceMs: 1699000000000, limit: 100 });

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('timestampMs >= ?'));
    });

    it('should combine multiple filters', async () => {
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: [] }),
      });

      await d1ListEventsFiltered(mockEnv, {
        eventType: 'finance.transaction',
        userId: 'user-123',
        sinceMs: 1699000000000,
        limit: 100,
      });

      const sql = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(sql).toContain('eventType = ?');
      expect(sql).toContain('userId = ?');
      expect(sql).toContain('timestampMs >= ?');
      expect(sql).toContain('AND');
    });

    it('should clamp limit between 1 and 500', async () => {
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: [] }),
      });

      await d1ListEventsFiltered(mockEnv, { limit: 1000 });

      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      // The limit should be clamped to 500
      expect(statement.bind).toHaveBeenCalledWith(500);
    });

    it('should enforce minimum limit of 1', async () => {
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: [] }),
      });

      await d1ListEventsFiltered(mockEnv, { limit: 0 });

      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith(1);
    });
  });

  // ============================================================================
  // Deduplication Tests
  // ============================================================================

  describe('d1InsertEventWithDedupe', () => {
    it('should insert a new event when no duplicate exists', async () => {
      // First call for idempotency check, second for insert
      const mockStatement = createMockStatement({
        first: vi.fn().mockResolvedValue({ eventId: '12345678-1234-1234-1234-123456789abc' }),
        run: vi.fn().mockResolvedValue({ success: true }),
      });
      mockEnv = {
        ...createMockEnv(),
        DB: {
          prepare: vi.fn().mockReturnValue(mockStatement),
        } as unknown as D1Database,
      };

      const result = await d1InsertEventWithDedupe(
        mockEnv,
        'user-123',
        'finance.transaction',
        'private',
        1700000000000,
        { amount: 100 }
      );

      expect(result).toEqual({ ok: true, id: '12345678-1234-1234-1234-123456789abc', deduped: false });
    });

    it('should return existing event ID when duplicate is found', async () => {
      // Idempotency check returns existing event ID
      const mockStatement = createMockStatement({
        first: vi.fn().mockResolvedValue({ eventId: 'existing-event-id' }),
      });
      mockEnv = {
        ...createMockEnv(),
        DB: {
          prepare: vi.fn().mockReturnValue(mockStatement),
        } as unknown as D1Database,
      };

      const result = await d1InsertEventWithDedupe(
        mockEnv,
        'user-123',
        'finance.transaction',
        'private',
        1700000000000,
        { amount: 100 },
        undefined,
        'duplicate-key'
      );

      expect(result).toEqual({ ok: true, id: 'existing-event-id', deduped: true });
    });

    it('should use provided dedupeKey for idempotency', async () => {
      const mockStatement = createMockStatement({
        first: vi.fn().mockResolvedValue({ eventId: '12345678-1234-1234-1234-123456789abc' }),
      });
      mockEnv = {
        ...createMockEnv(),
        DB: {
          prepare: vi.fn().mockReturnValue(mockStatement),
        } as unknown as D1Database,
      };

      await d1InsertEventWithDedupe(
        mockEnv,
        'user-123',
        'finance.transaction',
        'private',
        1700000000000,
        { amount: 100 },
        undefined,
        'custom-dedupe-key'
      );

      // Verify the idempotency key was used
      expect(mockStatement.bind).toHaveBeenCalledWith(
        'user-123',
        'custom-dedupe-key',
        '12345678-1234-1234-1234-123456789abc',
        expect.any(Number)
      );
    });

    it('should extract sourceApp from eventType', async () => {
      const mockStatement = createMockStatement({
        first: vi.fn().mockResolvedValue({ eventId: '12345678-1234-1234-1234-123456789abc' }),
      });
      mockEnv = {
        ...createMockEnv(),
        DB: {
          prepare: vi.fn().mockReturnValue(mockStatement),
        } as unknown as D1Database,
      };

      await d1InsertEventWithDedupe(
        mockEnv,
        'user-123',
        'calendar.event_created',
        'private',
        1700000000000,
        { title: 'Meeting' }
      );

      // The third call to bind is the INSERT, which has sourceApp in position 2 (0-indexed)
      const insertBindCall = mockStatement.bind.mock.calls[2];
      expect(insertBindCall[2]).toBe('calendar'); // sourceApp extracted from eventType
    });

    it('should handle payloadPreview', async () => {
      const mockStatement = createMockStatement({
        first: vi.fn().mockResolvedValue({ eventId: '12345678-1234-1234-1234-123456789abc' }),
      });
      mockEnv = {
        ...createMockEnv(),
        DB: {
          prepare: vi.fn().mockReturnValue(mockStatement),
        } as unknown as D1Database,
      };

      const payloadPreview = { summary: 'Test preview' };
      await d1InsertEventWithDedupe(
        mockEnv,
        'user-123',
        'finance.transaction',
        'private',
        1700000000000,
        { amount: 100 },
        payloadPreview
      );

      // The third call to bind is the INSERT, payloadPreviewJson is at position 11 (0-indexed)
      const insertBindCall = mockStatement.bind.mock.calls[2];
      expect(insertBindCall[11]).toBe(JSON.stringify(payloadPreview));
    });

    it('should return error on database failure', async () => {
      // Create a mock that succeeds for idempotency insert but fails for event insert
      const runMock = vi.fn()
        .mockResolvedValueOnce({ success: true })  // idempotency INSERT OR IGNORE
        .mockRejectedValueOnce(new Error('UNIQUE constraint failed')); // event INSERT fails

      const mockStatement = createMockStatement({
        first: vi.fn().mockResolvedValue({ eventId: '12345678-1234-1234-1234-123456789abc' }),
        run: runMock,
      });
      mockEnv = {
        ...createMockEnv(),
        DB: {
          prepare: vi.fn().mockReturnValue(mockStatement),
        } as unknown as D1Database,
      };

      const result = await d1InsertEventWithDedupe(
        mockEnv,
        'user-123',
        'finance.transaction',
        'private',
        1700000000000,
        { amount: 100 }
      );

      expect(result).toEqual({ ok: false, error: 'UNIQUE constraint failed' });
    });
  });

  describe('d1InsertEventsBatch', () => {
    it('should insert multiple events', async () => {
      const mockStatement = createMockStatement({
        first: vi.fn().mockResolvedValue({ eventId: '12345678-1234-1234-1234-123456789abc' }),
      });
      mockEnv = {
        ...createMockEnv(),
        DB: {
          prepare: vi.fn().mockReturnValue(mockStatement),
        } as unknown as D1Database,
      };

      const events = [
        { eventType: 'finance.transaction', privacyScope: 'private' as const, tsMs: 1700000000000, payload: { a: 1 } },
        { eventType: 'finance.balance', privacyScope: 'private' as const, tsMs: 1700000001000, payload: { b: 2 } },
      ];

      const results = await d1InsertEventsBatch(mockEnv, 'user-123', events);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ ok: true, id: '12345678-1234-1234-1234-123456789abc', deduped: false });
      expect(results[1]).toEqual({ ok: true, id: '12345678-1234-1234-1234-123456789abc', deduped: false });
    });
  });

  describe('d1UpsertIdempotency', () => {
    it('should insert and return the event ID', async () => {
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue({ eventId: 'evt-123' }),
      });

      const result = await d1UpsertIdempotency(mockEnv, 'user-123', 'idem-key', 'evt-123');

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT OR IGNORE'));
      expect(result).toBe('evt-123');
    });

    it('should return null when no idempotency record exists', async () => {
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue(null),
      });

      const result = await d1UpsertIdempotency(mockEnv, 'user-123', 'idem-key', 'evt-123');

      expect(result).toBeNull();
    });
  });

  // ============================================================================
  // Delivery Status Tests
  // ============================================================================

  describe('d1MarkConvexDelivery', () => {
    it('should mark delivery as ok with timestamp', async () => {
      mockEnv = createMockEnv();
      const result: DeliveryResult = { success: true, httpStatus: 200 };

      await d1MarkConvexDelivery(mockEnv, 'evt-123', result);

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE events'));
      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith(
        'ok',
        1700000000000,
        'ok',
        null,
        'evt-123'
      );
    });

    it('should mark delivery as failed with error message', async () => {
      mockEnv = createMockEnv();
      const result: DeliveryResult = { success: false, error: 'Connection timeout' };

      await d1MarkConvexDelivery(mockEnv, 'evt-123', result);

      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith(
        'failed',
        expect.any(Number),
        'failed',
        'Connection timeout',
        'evt-123'
      );
    });

    it('should map skipReason to failed status', async () => {
      mockEnv = createMockEnv();
      const result: DeliveryResult = { success: false, skipReason: 'No consent' };

      await d1MarkConvexDelivery(mockEnv, 'evt-123', result);

      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith(
        'failed',
        expect.any(Number),
        'failed',
        'No consent',
        'evt-123'
      );
    });
  });

  describe('d1MarkConvexDeliverySimple', () => {
    it('should call d1MarkConvexDelivery with correct params for success', async () => {
      mockEnv = createMockEnv();

      await d1MarkConvexDeliverySimple(mockEnv, 'evt-123', true);

      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith('ok', expect.any(Number), 'ok', null, 'evt-123');
    });

    it('should call d1MarkConvexDelivery with correct params for failure', async () => {
      mockEnv = createMockEnv();

      await d1MarkConvexDeliverySimple(mockEnv, 'evt-123', false, 'API error');

      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith('failed', expect.any(Number), 'failed', 'API error', 'evt-123');
    });
  });

  describe('d1MarkSocialDelivery', () => {
    it('should mark delivery as ok', async () => {
      mockEnv = createMockEnv();
      const result: DeliveryResult = { success: true };

      await d1MarkSocialDelivery(mockEnv, 'evt-123', result);

      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith('ok', expect.any(Number), 'ok', null, 'evt-123');
    });

    it('should mark delivery as skipped when skipReason provided', async () => {
      mockEnv = createMockEnv();
      const result: DeliveryResult = { success: false, skipReason: 'Private scope' };

      await d1MarkSocialDelivery(mockEnv, 'evt-123', result);

      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith('skipped', expect.any(Number), 'skipped', 'Private scope', 'evt-123');
    });

    it('should mark delivery as failed with error', async () => {
      mockEnv = createMockEnv();
      const result: DeliveryResult = { success: false, error: 'Network error' };

      await d1MarkSocialDelivery(mockEnv, 'evt-123', result);

      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith('failed', expect.any(Number), 'failed', 'Network error', 'evt-123');
    });
  });

  describe('d1MarkSocialDeliverySimple', () => {
    it('should work for success case', async () => {
      mockEnv = createMockEnv();

      await d1MarkSocialDeliverySimple(mockEnv, 'evt-123', true);

      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith('ok', expect.any(Number), 'ok', null, 'evt-123');
    });
  });

  describe('d1SkipSocialDelivery', () => {
    it('should mark event as skipped with reason', async () => {
      mockEnv = createMockEnv();

      await d1SkipSocialDelivery(mockEnv, 'evt-123', 'Privacy blocked');

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining("toSocialStatus = 'skipped'"));
      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith('Privacy blocked', 'evt-123');
    });
  });

  describe('d1GetFailedDeliveries', () => {
    it('should get failed Convex deliveries', async () => {
      const mockEvents = [{ id: 'evt-1', toConvexStatus: 'failed' }];
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: mockEvents }),
      });

      const result = await d1GetFailedDeliveries(mockEnv, 'convex');

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(
        expect.stringContaining("toConvexStatus = 'failed'")
      );
      expect(result).toEqual(mockEvents);
    });

    it('should get failed Social deliveries', async () => {
      const mockEvents = [{ id: 'evt-1', toSocialStatus: 'failed' }];
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: mockEvents }),
      });

      const result = await d1GetFailedDeliveries(mockEnv, 'social');

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(
        expect.stringContaining("toSocialStatus = 'failed'")
      );
      expect(result).toEqual(mockEvents);
    });

    it('should respect limit parameter', async () => {
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: [] }),
      });

      await d1GetFailedDeliveries(mockEnv, 'convex', 50);

      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith(50);
    });

    it('should use default limit of 100', async () => {
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: [] }),
      });

      await d1GetFailedDeliveries(mockEnv, 'convex');

      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith(100);
    });
  });

  describe('d1GetPendingDeliveries', () => {
    it('should get pending Convex deliveries older than threshold', async () => {
      const mockEvents = [{ id: 'evt-1', toConvexStatus: 'pending' }];
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: mockEvents }),
      });

      const olderThanMs = 1699999000000;
      const result = await d1GetPendingDeliveries(mockEnv, 'convex', olderThanMs);

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(
        expect.stringContaining("toConvexStatus = 'pending'")
      );
      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(
        expect.stringContaining('receivedAtMs < ?')
      );
      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith(olderThanMs, 100);
      expect(result).toEqual(mockEvents);
    });

    it('should get pending Social deliveries', async () => {
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: [] }),
      });

      await d1GetPendingDeliveries(mockEnv, 'social', 1699999000000, 50);

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(
        expect.stringContaining("toSocialStatus = 'pending'")
      );
    });
  });

  // ============================================================================
  // Consent Tests
  // ============================================================================

  describe('d1GetConsent', () => {
    it('should return true when consent is enabled in legacy table', async () => {
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue({ enabled: 1 }),
      });

      const result = await d1GetConsent(mockEnv, 'user-123', 'finance.transactions');

      expect(result).toBe(true);
    });

    it('should return false when consent is disabled', async () => {
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue({ enabled: 0 }),
      });

      const result = await d1GetConsent(mockEnv, 'user-123', 'finance.transactions');

      expect(result).toBe(false);
    });

    it('should fall back to user_consents table when not in legacy table', async () => {
      // First call returns null (legacy), second returns user consents
      const mockStatement = {
        bind: vi.fn().mockReturnThis(),
        run: vi.fn().mockResolvedValue({ success: true }),
        first: vi.fn()
          .mockResolvedValueOnce(null) // Legacy table
          .mockResolvedValueOnce({ // User consents table
            consentVersion: '1.0',
            scopesJson: JSON.stringify({ 'finance.transactions': true }),
            updatedAtMs: 1700000000000,
          }),
        all: vi.fn().mockResolvedValue({ results: [] }),
      };
      mockEnv = {
        ...createMockEnv(),
        DB: {
          prepare: vi.fn().mockReturnValue(mockStatement),
        } as unknown as D1Database,
      };

      const result = await d1GetConsent(mockEnv, 'user-123', 'finance.transactions');

      expect(result).toBe(true);
    });

    it('should return false when consent not found in any table', async () => {
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue(null),
      });

      const result = await d1GetConsent(mockEnv, 'user-123', 'unknown.scope');

      expect(result).toBe(false);
    });
  });

  describe('d1SetConsent', () => {
    it('should upsert consent with enabled=true', async () => {
      mockEnv = createMockEnv();

      await d1SetConsent(mockEnv, 'user-123', 'finance.transactions', true);

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO consents'));
      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT'));
      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith(
        'user-123',
        'finance.transactions',
        1, // enabled
        1700000000000,
        1,
        1700000000000
      );
    });

    it('should upsert consent with enabled=false', async () => {
      mockEnv = createMockEnv();

      await d1SetConsent(mockEnv, 'user-123', 'finance.transactions', false);

      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith(
        'user-123',
        'finance.transactions',
        0, // disabled
        1700000000000,
        0,
        1700000000000
      );
    });
  });

  describe('d1ListConsents', () => {
    it('should list all consents for a user', async () => {
      const mockResults = [
        { scope: 'finance.transactions', enabled: 1, updatedAtMs: 1700000000000 },
        { scope: 'calendar.events', enabled: 0, updatedAtMs: 1699000000000 },
      ];
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: mockResults }),
      });

      const result = await d1ListConsents(mockEnv, 'user-123');

      expect(result).toEqual([
        { scope: 'finance.transactions', enabled: true, updatedAt: 1700000000000 },
        { scope: 'calendar.events', enabled: false, updatedAt: 1699000000000 },
      ]);
    });

    it('should return empty array when no consents found', async () => {
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: undefined }),
      });

      const result = await d1ListConsents(mockEnv, 'user-123');

      expect(result).toEqual([]);
    });
  });

  describe('d1GetUserConsents', () => {
    it('should return parsed user consents', async () => {
      const mockRow = {
        consentVersion: '2.0',
        scopesJson: JSON.stringify({ 'finance.transactions': true, 'calendar.events': false }),
        updatedAtMs: 1700000000000,
      };
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue(mockRow),
      });

      const result = await d1GetUserConsents(mockEnv, 'user-123');

      expect(result).toEqual({
        consentVersion: '2.0',
        scopes: { 'finance.transactions': true, 'calendar.events': false },
        updatedAtMs: 1700000000000,
      });
    });

    it('should return null when no user consents found', async () => {
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue(null),
      });

      const result = await d1GetUserConsents(mockEnv, 'user-123');

      expect(result).toBeNull();
    });
  });

  describe('d1SetUserConsents', () => {
    it('should upsert user consents', async () => {
      mockEnv = createMockEnv();
      const scopes = { 'finance.transactions': true, 'calendar.events': false };

      await d1SetUserConsents(mockEnv, 'user-123', '2.0', scopes);

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO user_consents'));
      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT'));
      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith(
        'user-123',
        '2.0',
        JSON.stringify(scopes),
        1700000000000,
        '2.0',
        JSON.stringify(scopes),
        1700000000000
      );
    });
  });

  describe('d1CheckUserConsent', () => {
    it('should return true when scope is enabled', async () => {
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue({
          consentVersion: '1.0',
          scopesJson: JSON.stringify({ 'finance.transactions': true }),
          updatedAtMs: 1700000000000,
        }),
      });

      const result = await d1CheckUserConsent(mockEnv, 'user-123', 'finance.transactions');

      expect(result).toBe(true);
    });

    it('should return false when scope is disabled', async () => {
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue({
          consentVersion: '1.0',
          scopesJson: JSON.stringify({ 'finance.transactions': false }),
          updatedAtMs: 1700000000000,
        }),
      });

      const result = await d1CheckUserConsent(mockEnv, 'user-123', 'finance.transactions');

      expect(result).toBe(false);
    });

    it('should return false when no consents exist', async () => {
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue(null),
      });

      const result = await d1CheckUserConsent(mockEnv, 'user-123', 'finance.transactions');

      expect(result).toBe(false);
    });
  });

  describe('d1CheckUserConsents', () => {
    it('should return true when all scopes are enabled', async () => {
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue({
          consentVersion: '1.0',
          scopesJson: JSON.stringify({
            'finance.transactions': true,
            'calendar.events': true,
          }),
          updatedAtMs: 1700000000000,
        }),
      });

      const result = await d1CheckUserConsents(mockEnv, 'user-123', ['finance.transactions', 'calendar.events']);

      expect(result).toBe(true);
    });

    it('should return false when any scope is disabled', async () => {
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue({
          consentVersion: '1.0',
          scopesJson: JSON.stringify({
            'finance.transactions': true,
            'calendar.events': false,
          }),
          updatedAtMs: 1700000000000,
        }),
      });

      const result = await d1CheckUserConsents(mockEnv, 'user-123', ['finance.transactions', 'calendar.events']);

      expect(result).toBe(false);
    });

    it('should return true for empty scopes array', async () => {
      mockEnv = createMockEnv();

      const result = await d1CheckUserConsents(mockEnv, 'user-123', []);

      expect(result).toBe(true);
    });
  });

  // ============================================================================
  // Audit Log Tests
  // ============================================================================

  describe('d1Audit', () => {
    it('should insert audit log entry with userId', async () => {
      mockEnv = createMockEnv();

      await d1Audit(mockEnv, 'login', 'User logged in', 'user-123');

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO audit_log'));
      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith(1700000000000, 'user-123', 'login', 'User logged in');
    });

    it('should insert audit log entry without userId', async () => {
      mockEnv = createMockEnv();

      await d1Audit(mockEnv, 'system.startup', 'System initialized');

      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith(1700000000000, null, 'system.startup', 'System initialized');
    });
  });

  // ============================================================================
  // Event Blobs Tests
  // ============================================================================

  describe('d1InsertEventBlobs', () => {
    it('should insert blob references for an event', async () => {
      mockEnv = createMockEnv();
      const blobRefs: BlobRefRow[] = [
        { r2Key: 'blob-1', contentType: 'image/png', sizeBytes: 1024 },
        { r2Key: 'blob-2', contentType: 'application/pdf', sizeBytes: 2048 },
      ];

      await d1InsertEventBlobs(mockEnv, 'evt-123', blobRefs);

      expect(mockEnv.DB.prepare).toHaveBeenCalledTimes(2);
      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO event_blobs'));
    });

    it('should not insert when blobRefs is empty', async () => {
      mockEnv = createMockEnv();

      await d1InsertEventBlobs(mockEnv, 'evt-123', []);

      expect(mockEnv.DB.prepare).not.toHaveBeenCalled();
    });
  });

  describe('d1GetEventBlobs', () => {
    it('should return blob references for an event', async () => {
      const mockResults = [
        { r2Key: 'blob-1', contentType: 'image/png', sizeBytes: 1024 },
        { r2Key: 'blob-2', contentType: 'application/pdf', sizeBytes: 2048 },
      ];
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: mockResults }),
      });

      const result = await d1GetEventBlobs(mockEnv, 'evt-123');

      expect(result).toEqual(mockResults);
    });

    it('should return empty array when no blobs found', async () => {
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: undefined }),
      });

      const result = await d1GetEventBlobs(mockEnv, 'evt-123');

      expect(result).toEqual([]);
    });
  });

  describe('d1GetEventsByBlobKey', () => {
    it('should return events that reference a blob', async () => {
      const mockEvents = [{ id: 'evt-1' }, { id: 'evt-2' }];
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: mockEvents }),
      });

      const result = await d1GetEventsByBlobKey(mockEnv, 'blob-123');

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('INNER JOIN event_blobs'));
      expect(result).toEqual(mockEvents);
    });
  });

  describe('d1CountUserBlobs', () => {
    it('should return count and total bytes', async () => {
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue({ count: 5, totalBytes: 10240 }),
      });

      const result = await d1CountUserBlobs(mockEnv, 'user-123');

      expect(result).toEqual({ count: 5, totalBytes: 10240 });
    });

    it('should return zeros when no blobs found', async () => {
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue(null),
      });

      const result = await d1CountUserBlobs(mockEnv, 'user-123');

      expect(result).toEqual({ count: 0, totalBytes: 0 });
    });
  });

  describe('d1GetReferencedBlobKeys', () => {
    it('should return referenced blob keys', async () => {
      const mockResults = [{ r2Key: 'blob-1' }, { r2Key: 'blob-2' }];
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: mockResults }),
      });

      const result = await d1GetReferencedBlobKeys(mockEnv);

      expect(result).toEqual(['blob-1', 'blob-2']);
    });

    it('should respect limit parameter', async () => {
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: [] }),
      });

      await d1GetReferencedBlobKeys(mockEnv, 500);

      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith(500);
    });
  });

  // ============================================================================
  // Profile Snapshot Tests
  // ============================================================================

  describe('d1UpsertProfileSnapshot', () => {
    it('should insert new profile snapshot', async () => {
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue(null), // No existing record
      });
      const snapshot: ProfileSnapshotRow = {
        userId: 'user-123',
        questionnaireId: 'avatar.core.v1',
        questionnaireVersion: 1,
        answers: { q1: 'a1', q2: 'a2' },
        answerCount: 2,
        sourceApp: 'dashboard',
        updatedAtMs: 1700000000000,
        createdAtMs: 1700000000000,
        eventId: 'evt-123',
      };

      await d1UpsertProfileSnapshot(mockEnv, snapshot);

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO profile_snapshots'));
      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT'));
    });

    it('should preserve createdAtMs on update', async () => {
      const existingCreatedAt = 1699000000000;
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue({ createdAtMs: existingCreatedAt }),
      });
      const snapshot: ProfileSnapshotRow = {
        userId: 'user-123',
        questionnaireId: 'avatar.core.v1',
        questionnaireVersion: 2,
        answers: { q1: 'updated' },
        answerCount: 1,
        sourceApp: 'dashboard',
        updatedAtMs: 1700000000000,
        createdAtMs: 1700000000000,
      };

      await d1UpsertProfileSnapshot(mockEnv, snapshot);

      // Should use existing createdAtMs
      const insertCall = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.calls.find(
        call => call[0].includes('INSERT INTO profile_snapshots')
      );
      expect(insertCall).toBeDefined();
    });

    it('should insert into history table', async () => {
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue(null),
      });
      const snapshot: ProfileSnapshotRow = {
        userId: 'user-123',
        questionnaireId: 'avatar.core.v1',
        questionnaireVersion: 1,
        answers: {},
        answerCount: 0,
        sourceApp: 'dashboard',
        updatedAtMs: 1700000000000,
        createdAtMs: 1700000000000,
      };

      await d1UpsertProfileSnapshot(mockEnv, snapshot);

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO profile_snapshot_history'));
    });
  });

  describe('d1GetProfileSnapshot', () => {
    it('should return profile snapshot', async () => {
      const mockRow = {
        userId: 'user-123',
        questionnaireId: 'avatar.core.v1',
        questionnaireVersion: 1,
        answersJson: JSON.stringify({ q1: 'a1' }),
        answerCount: 1,
        sourceApp: 'dashboard',
        updatedAtMs: 1700000000000,
        createdAtMs: 1699000000000,
        eventId: 'evt-123',
      };
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue(mockRow),
      });

      const result = await d1GetProfileSnapshot(mockEnv, 'user-123', 'avatar.core.v1');

      expect(result).toEqual({
        userId: 'user-123',
        questionnaireId: 'avatar.core.v1',
        questionnaireVersion: 1,
        answers: { q1: 'a1' },
        answerCount: 1,
        sourceApp: 'dashboard',
        updatedAtMs: 1700000000000,
        createdAtMs: 1699000000000,
        eventId: 'evt-123',
      });
    });

    it('should return null when not found', async () => {
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue(null),
      });

      const result = await d1GetProfileSnapshot(mockEnv, 'user-123', 'nonexistent');

      expect(result).toBeNull();
    });

    it('should handle null eventId', async () => {
      const mockRow = {
        userId: 'user-123',
        questionnaireId: 'avatar.core.v1',
        questionnaireVersion: 1,
        answersJson: '{}',
        answerCount: 0,
        sourceApp: 'dashboard',
        updatedAtMs: 1700000000000,
        createdAtMs: 1700000000000,
        eventId: null,
      };
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue(mockRow),
      });

      const result = await d1GetProfileSnapshot(mockEnv, 'user-123', 'avatar.core.v1');

      expect(result?.eventId).toBeUndefined();
    });
  });

  describe('d1ListProfileSnapshots', () => {
    it('should return all snapshots for a user', async () => {
      const mockResults = [
        {
          userId: 'user-123',
          questionnaireId: 'avatar.core.v1',
          questionnaireVersion: 1,
          answersJson: '{}',
          answerCount: 0,
          sourceApp: 'dashboard',
          updatedAtMs: 1700000000000,
          createdAtMs: 1700000000000,
          eventId: null,
        },
      ];
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: mockResults }),
      });

      const result = await d1ListProfileSnapshots(mockEnv, 'user-123');

      expect(result).toHaveLength(1);
      expect(result[0].questionnaireId).toBe('avatar.core.v1');
    });
  });

  describe('d1GetAvatarSnapshot', () => {
    it('should return avatar snapshot', async () => {
      const mockRow = {
        userId: 'user-123',
        questionnaireId: 'avatar.core.v1',
        questionnaireVersion: 1,
        answersJson: '{}',
        answerCount: 0,
        sourceApp: 'dashboard',
        updatedAtMs: 1700000000000,
        createdAtMs: 1700000000000,
        eventId: null,
      };
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue(mockRow),
      });

      const result = await d1GetAvatarSnapshot(mockEnv, 'user-123');

      expect(result?.questionnaireId).toBe('avatar.core.v1');
      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining("LIKE 'avatar.%'"));
    });

    it('should return null when no avatar snapshot exists', async () => {
      mockEnv = createMockEnv({
        first: vi.fn().mockResolvedValue(null),
      });

      const result = await d1GetAvatarSnapshot(mockEnv, 'user-123');

      expect(result).toBeNull();
    });
  });

  describe('d1GetAppSnapshots', () => {
    it('should return app snapshots without appId filter', async () => {
      const mockResults = [
        {
          userId: 'user-123',
          questionnaireId: 'email.preferences',
          questionnaireVersion: 1,
          answersJson: '{}',
          answerCount: 0,
          sourceApp: 'email',
          updatedAtMs: 1700000000000,
          createdAtMs: 1700000000000,
          eventId: null,
        },
      ];
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: mockResults }),
      });

      const result = await d1GetAppSnapshots(mockEnv, 'user-123');

      expect(result).toHaveLength(1);
      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining("NOT LIKE 'avatar.%'"));
    });

    it('should filter by appId when provided', async () => {
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: [] }),
      });

      await d1GetAppSnapshots(mockEnv, 'user-123', 'email');

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('sourceApp = ?'));
      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith('user-123', 'email');
    });
  });

  // ============================================================================
  // Recent Events Tests
  // ============================================================================

  describe('d1GetRecentEvents', () => {
    it('should return recent events for a user', async () => {
      const mockEvents = [{ id: 'evt-1' }, { id: 'evt-2' }];
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: mockEvents }),
      });

      const result = await d1GetRecentEvents(mockEnv, 'user-123');

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('WHERE userId = ?'));
      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('ORDER BY timestampMs DESC'));
      expect(result).toEqual(mockEvents);
    });

    it('should respect limit parameter', async () => {
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: [] }),
      });

      await d1GetRecentEvents(mockEnv, 'user-123', 25);

      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith('user-123', 25);
    });

    it('should clamp limit to maximum of 200', async () => {
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: [] }),
      });

      await d1GetRecentEvents(mockEnv, 'user-123', 500);

      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith('user-123', 200);
    });

    it('should enforce minimum limit of 1', async () => {
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: [] }),
      });

      await d1GetRecentEvents(mockEnv, 'user-123', 0);

      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith('user-123', 1);
    });

    it('should filter by event types when provided', async () => {
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: [] }),
      });

      await d1GetRecentEvents(mockEnv, 'user-123', 50, ['finance.transaction', 'calendar.event']);

      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('eventType IN (?, ?)'));
      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith('user-123', 'finance.transaction', 'calendar.event', 50);
    });

    it('should use default limit of 50', async () => {
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: [] }),
      });

      await d1GetRecentEvents(mockEnv, 'user-123');

      const statement = (mockEnv.DB.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(statement.bind).toHaveBeenCalledWith('user-123', 50);
    });

    it('should return empty array when no results', async () => {
      mockEnv = createMockEnv({
        all: vi.fn().mockResolvedValue({ results: undefined }),
      });

      const result = await d1GetRecentEvents(mockEnv, 'user-123');

      expect(result).toEqual([]);
    });
  });
});
