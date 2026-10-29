import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { createAppServer } from '../../backend/server';
import { CloudCoachAgent } from '../../backend/llm_agent';
import {
  resetDatabase,
  upsertSession,
  insertRepScore,
  insertAnomalyLog
} from '../../backend/db';

describe('Backend API Routes & WebSocket Protocol (Integration Tests)', () => {
  let server: http.Server;
  let baseUrl: string;
  let wsUrl: string;

  beforeEach(async () => {
    resetDatabase();
    const app = createAppServer(new CloudCoachAgent(null));
    server = app.server;

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    wsUrl = `ws://127.0.0.1:${address.port}/ws/coach`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  describe('HTTP REST Endpoints', () => {
    it('GET /api/health returns 200 OK with Zero-Media privacy metadata', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');

      const data = await res.json();
      expect(data.status).toBe('ok');
      expect(data.engine).toBe('Agent 2 Cloud');
      expect(data.privacy).toBe('ZERO_MEDIA');
    });

    it('OPTIONS /api/health responds with 204 No Content and CORS headers', async () => {
      const res = await fetch(`${baseUrl}/api/health`, { method: 'OPTIONS' });
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-methods')).toContain('DELETE');
    });

    it('GET /api/progression/history & GET /api/progression/session/:id return stored sessions and reps', async () => {
      upsertSession({
        id: 'ses_api_1',
        created_at: '2026-10-29T10:00:00.000Z',
        exercise: 'squat',
        total_reps: 0,
        avg_global_score: 0,
        avg_stability: 0,
        avg_tempo: 0,
        avg_depth: 0,
        avg_posture: 0
      });

      insertRepScore({
        id: 'rep_api_1',
        session_id: 'ses_api_1',
        rep_number: 1,
        global_score: 92,
        stability_score: 95,
        tempo_score: 90,
        depth_score: 90,
        posture_score: 92,
        duration_sec: 3.1,
        created_at: '2026-10-29T10:00:05.000Z'
      });

      const histRes = await fetch(`${baseUrl}/api/progression/history?limit=5`);
      expect(histRes.status).toBe(200);
      const histData = await histRes.json();
      expect(histData.sessions).toHaveLength(1);
      expect(histData.sessions[0].id).toBe('ses_api_1');
      expect(histData.sessions[0].total_reps).toBe(1);
      expect(histData.sessions[0].avg_global_score).toBe(92);

      const sessionRes = await fetch(`${baseUrl}/api/progression/session/ses_api_1`);
      expect(sessionRes.status).toBe(200);
      const sessionData = await sessionRes.json();
      expect(sessionData.sessionId).toBe('ses_api_1');
      expect(sessionData.reps).toHaveLength(1);
      expect(sessionData.reps[0].stability_score).toBe(95);
    });

    it('POST /api/coach/infer infers coaching correction and stores privacy audit log', async () => {
      const inferRes = await fetch(`${baseUrl}/api/coach/infer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: 'evt_rest_1',
          sessionId: 'ses_rest_1',
          exercise: 'squat',
          repNumber: 2,
          phase: 'DESCENT',
          type: 'KNEE_VALGUS',
          severity: 'CRITICAL',
          metrics: {
            kneeAngle: 95,
            torsoAngle: 20,
            kneeDistanceRatio: 0.58,
            phaseDurationSec: 1.8
          },
          explanation: 'Valgus sévère'
        })
      });

      expect(inferRes.status).toBe(200);
      const inferData = await inferRes.json();
      expect(inferData.actionZone).toBe('KNEES');
      expect(inferData.cueText).toContain('Pousse le sol');

      // Verify it was saved in /api/audit/logs
      const logsRes = await fetch(`${baseUrl}/api/audit/logs`);
      expect(logsRes.status).toBe(200);
      const logsData = await logsRes.json();
      expect(logsData.logs).toHaveLength(1);
      expect(logsData.logs[0].id).toBe('evt_rest_1');
      expect(logsData.logs[0].anomaly_type).toBe('KNEE_VALGUS');
    });

    it('POST /api/coach/infer returns 400 on invalid payload', async () => {
      const badRes = await fetch(`${baseUrl}/api/coach/infer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invalid: true })
      });
      expect(badRes.status).toBe(400);
    });

    it('DELETE /api/audit/logs clears the SQLite privacy audit log', async () => {
      insertAnomalyLog({
        id: 'evt_del_1',
        session_id: 'ses_1',
        rep_number: 1,
        anomaly_type: 'TEMPO_TOO_FAST',
        severity: 'HIGH',
        generated_prompt: 'Prompt test',
        llm_response: 'Ralentis !',
        latency_ms: 5,
        created_at: new Date().toISOString()
      });

      const delRes = await fetch(`${baseUrl}/api/audit/logs`, { method: 'DELETE' });
      expect(delRes.status).toBe(200);

      const logsRes = await fetch(`${baseUrl}/api/audit/logs`);
      const logsData = await logsRes.json();
      expect(logsData.logs).toHaveLength(0);
    });

    it('returns 404 for unknown endpoints', async () => {
      const res = await fetch(`${baseUrl}/api/unknown-route`);
      expect(res.status).toBe(404);
    });
  });

  describe('WebSocket /ws/coach Real-Time Protocol', () => {
    it('handles CONNECTED, REP_SCORES, ANOMALY_EVENT, and END_SESSION lifecycle', async () => {
      const ws = new WebSocket(wsUrl);
      const messages: any[] = [];

      const waitForMessageType = (expectedType: string): Promise<any> =>
        new Promise((resolve) => {
          const existing = messages.find((m) => m.type === expectedType);
          if (existing) {
            resolve(existing);
            return;
          }
          const handler = (raw: WebSocket.RawData) => {
            const parsed = JSON.parse(raw.toString());
            if (parsed.type === expectedType) {
              ws.off('message', handler);
              resolve(parsed);
            }
          };
          ws.on('message', handler);
        });

      ws.on('message', (raw) => {
        messages.push(JSON.parse(raw.toString()));
      });

      // 1. Wait for CONNECTED
      const connectedMsg = await waitForMessageType('CONNECTED');
      expect(connectedMsg.sessionId).toMatch(/^ses_/);

      // 2. Send REP_SCORES
      const savedPromise = waitForMessageType('REP_SCORE_SAVED');
      ws.send(
        JSON.stringify({
          type: 'REP_SCORES',
          payload: {
            repNumber: 1,
            durationSec: 3.0,
            scores: {
              global: 95,
              stability: 95,
              tempo: 100,
              depth: 95,
              posture: 90
            }
          }
        })
      );
      const savedMsg = await savedPromise;
      expect(savedMsg.repNumber).toBe(1);
      expect(savedMsg.scores.global_score).toBe(95);

      // 3. Send ANOMALY_EVENT
      const cuePromise = waitForMessageType('COACHING_CUE');
      ws.send(
        JSON.stringify({
          type: 'ANOMALY_EVENT',
          payload: {
            eventId: 'evt_ws_1',
            timestamp: Date.now(),
            exercise: 'squat',
            repNumber: 2,
            phase: 'DESCENT',
            type: 'EXCESSIVE_TORSO_LEAN',
            severity: 'MODERATE',
            metrics: {
              kneeAngle: 100,
              torsoAngle: 52,
              kneeDistanceRatio: 0.9,
              phaseDurationSec: 2.0
            },
            explanation: 'Buste trop penché'
          }
        })
      );
      const cueMsg = await cuePromise;
      expect(cueMsg.feedback.actionZone).toBe('TORSO');
      expect(cueMsg.feedback.visualCue).toContain('Buste fier');

      // 4. Send END_SESSION
      const debriefPromise = waitForMessageType('SESSION_DEBRIEF');
      ws.send(JSON.stringify({ type: 'END_SESSION' }));
      const debriefMsg = await debriefPromise;
      expect(debriefMsg.debriefText).toContain('BILAN DE PROGRESSION');
      expect(debriefMsg.debriefText).toContain('1 répétitions analysées');

      ws.close();
    });
  });
});
