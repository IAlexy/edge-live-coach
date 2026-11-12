import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import {
  upsertSession,
  insertRepScore,
  insertAnomalyLog,
  getSessionHistory,
  getSessionReps,
  getRecentAnomalies,
  clearAnomalyLogs,
  SessionRecord,
  RepScoreRecord
} from './db';
import { CloudCoachAgent, AnomalyPayload } from './llm_agent';

export const DEFAULT_PORT = Number(process.env.PORT) || 8000;

function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body) as Record<string, unknown>);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

export function createAppServer(coachAgent = new CloudCoachAgent()): {
  server: http.Server;
  wss: WebSocketServer;
} {
  const server = http.createServer(async (req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // 1. Healthcheck
    if (req.method === 'GET' && url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          engine: 'Agent 2 Cloud',
          privacy: 'ZERO_MEDIA',
          port: DEFAULT_PORT
        })
      );
      return;
    }

    // 2. Historique global des sessions et scores de progression
    if (req.method === 'GET' && url.pathname === '/api/progression/history') {
      const limitParam = Number(url.searchParams.get('limit'));
      const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 15;
      const history = getSessionHistory(limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessions: history }));
      return;
    }

    // 3. Détail des répétitions d'une session
    if (req.method === 'GET' && url.pathname.startsWith('/api/progression/session/')) {
      const sessionId = decodeURIComponent(url.pathname.split('/').pop() || '');
      const reps = getSessionReps(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessionId, reps }));
      return;
    }

    // 4. Journal d'audit de confidentialité (Prompts / Réponses)
    if (req.method === 'GET' && url.pathname === '/api/audit/logs') {
      const limitParam = Number(url.searchParams.get('limit'));
      const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 30;
      const logs = getRecentAnomalies(limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ logs }));
      return;
    }

    // 5. Purge du journal d'audit
    if (req.method === 'DELETE' && url.pathname === '/api/audit/logs') {
      clearAnomalyLogs();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'cleared' }));
      return;
    }

    // 6. Inférence REST synchrone d'une anomalie (Agent 1 -> Agent 2)
    if (req.method === 'POST' && url.pathname === '/api/coach/infer') {
      try {
        const body = await readJsonBody(req);
        if (!body || typeof body.type !== 'string' || typeof body.metrics !== 'object' || !body.metrics) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Payload biomécanique invalide' }));
          return;
        }

        const payload: AnomalyPayload = {
          eventId: String(body.eventId || `evt_${Date.now()}`),
          sessionId: String(body.sessionId || 'rest_session'),
          timestamp: Number(body.timestamp || Date.now()),
          exercise: String(body.exercise || 'squat'),
          repNumber: Number(body.repNumber || 1),
          phase: String(body.phase || 'DESCENT'),
          type: String(body.type),
          severity: String(body.severity || 'MODERATE'),
          metrics: body.metrics as AnomalyPayload['metrics'],
          explanation: String(body.explanation || ''),
          lang: typeof body.lang === 'string' ? body.lang : undefined
        };

        const result = await coachAgent.inferCorrection(payload);
        insertAnomalyLog({
          id: payload.eventId,
          session_id: payload.sessionId,
          rep_number: payload.repNumber,
          anomaly_type: payload.type,
          severity: payload.severity,
          generated_prompt: result.prompt,
          llm_response: result.cueText,
          latency_ms: result.latencyMs,
          created_at: new Date().toISOString()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Requête JSON malformée' }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint non trouvé' }));
  });

  // Serveur WebSocket
  const wss = new WebSocketServer({ server, path: '/ws/coach' });

  wss.on('connection', (ws: WebSocket) => {
    const sessionId = `ses_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // Enregistrement initial de la session
    const initialSession: SessionRecord = {
      id: sessionId,
      created_at: new Date().toISOString(),
      exercise: 'squat',
      total_reps: 0,
      avg_global_score: 0,
      avg_stability: 0,
      avg_tempo: 0,
      avg_depth: 0,
      avg_posture: 0
    };
    upsertSession(initialSession);

    // Message de bienvenue avec l'historique récent
    ws.send(
      JSON.stringify({
        type: 'CONNECTED',
        sessionId,
        pastSessions: getSessionHistory(5)
      })
    );

    ws.on('message', async (data: RawData) => {
      try {
        const message = JSON.parse(data.toString());

        // 1. Réception d'une anomalie en temps réel (Agent 1 -> Agent 2)
        if (message.type === 'ANOMALY_EVENT') {
          const payload: AnomalyPayload = {
            ...message.payload,
            sessionId
          };

          // Évaluation de la tendance récente pour enrichir l'analyse
          const reps = getSessionReps(sessionId);
          if (reps.length >= 3) {
            const recentReps = reps.slice(-3);
            const recentAvgStability =
              recentReps.reduce((a, b) => a + b.stability_score, 0) / recentReps.length;
            payload.recentTrend = {
              stabilityAvg: Math.round(recentAvgStability),
              fatigueDetected: recentAvgStability < 70
            };
          }

          // Inférence du LLM Cloud
          const result = await coachAgent.inferCorrection(payload);

          // Enregistrement dans le journal d'audit de confidentialité (Zéro Média)
          insertAnomalyLog({
            id: payload.eventId,
            session_id: sessionId,
            rep_number: payload.repNumber,
            anomaly_type: payload.type,
            severity: payload.severity,
            generated_prompt: result.prompt,
            llm_response: result.cueText,
            latency_ms: result.latencyMs,
            created_at: new Date().toISOString()
          });

          // Retour immédiat de la consigne au client
          ws.send(
            JSON.stringify({
              type: 'COACHING_CUE',
              feedback: {
                audioCue: result.cueText,
                visualCue: result.cueText,
                actionZone: result.actionZone,
                latencyMs: result.latencyMs,
                prompt: result.prompt,
                timestamp: Date.now()
              }
            })
          );
        }

        // 2. Réception du score d'une répétition validée (Évaluation multi-facteurs)
        else if (message.type === 'REP_SCORES') {
          const { repNumber, scores, durationSec } = message.payload;
          const repRecord: RepScoreRecord = {
            id: `rep_${sessionId}_${repNumber}`,
            session_id: sessionId,
            rep_number: repNumber,
            global_score: scores.global,
            stability_score: scores.stability,
            tempo_score: scores.tempo,
            depth_score: scores.depth,
            posture_score: scores.posture,
            duration_sec: durationSec || 3.0,
            created_at: new Date().toISOString()
          };

          insertRepScore(repRecord);

          // Confirmation au client avec état actualisé
          ws.send(
            JSON.stringify({
              type: 'REP_SCORE_SAVED',
              repNumber,
              scores: repRecord
            })
          );
        }

        // 3. Fin de session : Génération du débriefing de progression
        else if (message.type === 'END_SESSION') {
          const lang = typeof message.lang === 'string' ? message.lang : 'fr';
          const debrief = await coachAgent.generateSessionDebrief(sessionId, lang);
          ws.send(
            JSON.stringify({
              type: 'SESSION_DEBRIEF',
              debriefText: debrief
            })
          );
        }
      } catch (err) {
        console.error('[WebSocket] Erreur traitement message :', err);
      }
    });
  });

  return { server, wss };
}

const isMainModule =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

import path from 'node:path';

if (isMainModule && !process.env.VITEST) {
  const { server } = createAppServer();
  server.listen(DEFAULT_PORT, '0.0.0.0', () => {
    console.log(`🚀 Serveur Backend Cloud (Agent 2) à l'écoute sur http://0.0.0.0:${DEFAULT_PORT}`);
    console.log(`📡 WebSocket disponible sur ws://localhost:${DEFAULT_PORT}/ws/coach`);
    console.log(
      `🛡️ Mode Confidentialité Actif : Enregistrement métrique pur dans data/coaching_progression.db`
    );
  });
}
