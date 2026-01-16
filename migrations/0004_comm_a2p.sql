-- ==============================================
-- A2P Compliance + Communication Tables
-- Migration: 0004_comm_a2p
-- ==============================================

-- A2P 10DLC compliance tracking per user
CREATE TABLE IF NOT EXISTS comm_a2p (
  userId TEXT PRIMARY KEY,

  -- Status: not_started|draft|submitted|in_review|approved|rejected
  status TEXT NOT NULL DEFAULT 'not_started',

  -- Brand type: individual|business
  brandType TEXT,

  -- Wizard captured fields (JSON)
  dataJson TEXT NOT NULL DEFAULT '{}',

  -- Twilio references
  twilioBrandSid TEXT,
  twilioCampaignSid TEXT,

  -- Rejection details
  rejectionReason TEXT,

  -- Timestamps
  lastCheckedAtMs INTEGER,
  submittedAtMs INTEGER,
  approvedAtMs INTEGER,
  createdAtMs INTEGER NOT NULL,
  updatedAtMs INTEGER NOT NULL
);

-- Phone numbers owned by users
CREATE TABLE IF NOT EXISTS comm_numbers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  userId TEXT NOT NULL,
  e164 TEXT NOT NULL,
  friendlyName TEXT,

  -- Twilio reference
  twilioIncomingPhoneNumberSid TEXT NOT NULL,

  -- Capabilities
  capabilities TEXT DEFAULT '{}',  -- JSON: { "voice": true, "sms": true, "mms": false }

  -- Status: active|released|pending
  status TEXT NOT NULL DEFAULT 'active',

  -- Timestamps
  createdAtMs INTEGER NOT NULL,
  releasedAtMs INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_comm_numbers_user_e164
  ON comm_numbers(userId, e164);

CREATE INDEX IF NOT EXISTS idx_comm_numbers_user
  ON comm_numbers(userId);

-- SMS/MMS message log
CREATE TABLE IF NOT EXISTS comm_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  userId TEXT NOT NULL,

  -- Direction: inbound|outbound
  direction TEXT NOT NULL,

  -- Addresses
  fromE164 TEXT NOT NULL,
  toE164 TEXT NOT NULL,

  -- Twilio reference
  twilioMessageSid TEXT,

  -- Status: queued|sending|sent|delivered|failed|received
  status TEXT NOT NULL,

  -- Message content (store hash only for privacy, or encrypted)
  bodyPreview TEXT,  -- First 50 chars or "[media]"
  mediaCount INTEGER DEFAULT 0,

  -- Pricing
  priceCents INTEGER,
  currency TEXT DEFAULT 'USD',

  -- Error info
  errorCode TEXT,
  errorMessage TEXT,

  -- Timestamps
  sentAtMs INTEGER,
  deliveredAtMs INTEGER,
  createdAtMs INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comm_messages_user_time
  ON comm_messages(userId, createdAtMs DESC);

CREATE INDEX IF NOT EXISTS idx_comm_messages_sid
  ON comm_messages(twilioMessageSid);

-- Call log
CREATE TABLE IF NOT EXISTS comm_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  userId TEXT NOT NULL,

  -- Direction: inbound|outbound
  direction TEXT NOT NULL,

  -- Addresses
  fromE164 TEXT NOT NULL,
  toE164 TEXT NOT NULL,

  -- Twilio reference
  twilioCallSid TEXT NOT NULL,
  twilioParentCallSid TEXT,

  -- Status: initiated|ringing|in-progress|completed|busy|failed|no-answer|canceled
  status TEXT NOT NULL,

  -- Call details
  durationSeconds INTEGER,
  answeredBy TEXT,  -- human|machine|fax

  -- Recording info
  recordingEnabled INTEGER DEFAULT 0,
  recordingSid TEXT,
  recordingUrl TEXT,  -- R2 key, not Twilio URL
  recordingDurationSeconds INTEGER,

  -- Pricing
  priceCents INTEGER,
  currency TEXT DEFAULT 'USD',

  -- Timestamps
  startedAtMs INTEGER,
  answeredAtMs INTEGER,
  endedAtMs INTEGER,
  createdAtMs INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comm_calls_user_time
  ON comm_calls(userId, createdAtMs DESC);

CREATE INDEX IF NOT EXISTS idx_comm_calls_sid
  ON comm_calls(twilioCallSid);

-- Recording consent per user
CREATE TABLE IF NOT EXISTS comm_recording_consent (
  userId TEXT PRIMARY KEY,

  -- Consent status
  callRecordingEnabled INTEGER NOT NULL DEFAULT 0,
  transcriptionEnabled INTEGER NOT NULL DEFAULT 0,

  -- Consent version accepted
  consentVersion TEXT,

  -- Timestamps
  enabledAtMs INTEGER,
  disabledAtMs INTEGER,
  updatedAtMs INTEGER NOT NULL
);
