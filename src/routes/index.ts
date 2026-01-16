/**
 * Route registration for edge-gateway-worker
 */

import { adminEventsList, adminEventDetail, adminEventStats } from './adminEventsList';
import { dashboardSearch, dashboardEventDetail, dashboardTimeline } from './dashboardSearch';
import { twilioToken } from './twilioToken';
import {
  twilioVoiceOutgoing,
  twilioVoiceIncoming,
  twilioCallStatus,
  twilioRecordingStatus
} from './twilioWebhooks';
import { getRecordingConsent, updateRecordingConsent } from './commRecordingConsent';
import { a2pStatus, a2pStart, a2pSaveDraft, a2pSubmit, a2pRefresh } from './commA2p';
import { numberSearch, numberBuy, numberList, numberRelease } from './commNumbers';
import { smsSend } from './commSms';
import type { Env } from '../env';

export async function handleRequest(
  req: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // Health check
  if (path === '/health') {
    return Response.json({ ok: true, timestamp: Date.now() });
  }

  // Admin routes
  if (path === '/v1/events/list') {
    return adminEventsList(req, env);
  }

  if (path === '/v1/events/stats') {
    return adminEventStats(req, env);
  }

  if (path.startsWith('/v1/events/') && path !== '/v1/events/batch') {
    const eventId = path.split('/')[3];
    if (eventId) {
      return adminEventDetail(req, env, eventId);
    }
  }

  // Dashboard routes
  if (path === '/v1/dashboard/search') {
    return dashboardSearch(req, env);
  }

  if (path === '/v1/dashboard/timeline') {
    return dashboardTimeline(req, env);
  }

  if (path.startsWith('/v1/dashboard/event/')) {
    const eventId = path.split('/')[4];
    if (eventId) {
      return dashboardEventDetail(req, env, eventId);
    }
  }

  // Twilio routes
  if (path === '/v1/twilio/token') {
    return twilioToken(req, env);
  }

  // Twilio webhook routes (called by Twilio, not iOS app)
  if (path === '/v1/twilio/voice/outgoing') {
    return twilioVoiceOutgoing(req, env);
  }

  if (path === '/v1/twilio/voice/incoming') {
    return twilioVoiceIncoming(req, env);
  }

  if (path === '/v1/twilio/call/status') {
    return twilioCallStatus(req, env);
  }

  if (path === '/v1/twilio/recording/status') {
    return twilioRecordingStatus(req, env);
  }

  // Comm recording consent routes
  if (path === '/v1/comm/recording/consent') {
    if (req.method === 'GET') {
      return getRecordingConsent(req, env);
    }
    if (req.method === 'POST') {
      return updateRecordingConsent(req, env);
    }
    return new Response('Method not allowed', { status: 405 });
  }

  // A2P compliance routes
  if (path === '/v1/comm/a2p/status' && req.method === 'GET') {
    return a2pStatus(req, env);
  }

  if (path === '/v1/comm/a2p/start' && req.method === 'POST') {
    return a2pStart(req, env);
  }

  if (path === '/v1/comm/a2p/saveDraft' && req.method === 'POST') {
    return a2pSaveDraft(req, env);
  }

  if (path === '/v1/comm/a2p/submit' && req.method === 'POST') {
    return a2pSubmit(req, env);
  }

  if (path === '/v1/comm/a2p/refresh' && req.method === 'POST') {
    return a2pRefresh(req, env);
  }

  // Phone number routes
  if (path === '/v1/comm/number/search' && req.method === 'GET') {
    return numberSearch(req, env);
  }

  if (path === '/v1/comm/number/buy' && req.method === 'POST') {
    return numberBuy(req, env);
  }

  if (path === '/v1/comm/number/list' && req.method === 'GET') {
    return numberList(req, env);
  }

  if (path === '/v1/comm/number/release' && req.method === 'POST') {
    return numberRelease(req, env);
  }

  // SMS routes
  if (path === '/v1/comm/sms/send' && req.method === 'POST') {
    return smsSend(req, env);
  }

  // Not found
  return new Response(JSON.stringify({
    error: { code: 'NOT_FOUND', message: 'Route not found' }
  }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}
