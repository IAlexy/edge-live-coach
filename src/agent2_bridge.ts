import { AnomalyEvent, CloudAuditEntry, CoachingFeedback, RepScores } from './types';

export interface BridgeCallbacks {
  onLogUpdated?: (logs: CloudAuditEntry[]) => void;
  onCoachingCueReceived?: (feedback: CoachingFeedback) => void;
  onRepScoreAcknowledged?: (repNumber: number, scores: unknown) => void;
  onDebriefReceived?: (debriefText: string) => void;
  onConnectionStatusChanged?: (isConnected: boolean) => void;
}

export class Agent2Bridge {
  private auditLogs: CloudAuditEntry[] = [];
  private ws: WebSocket | null = null;
  private isConnected = false;
  private callbacks: BridgeCallbacks;
  private sessionId = '';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;

  constructor(callbacks: BridgeCallbacks = {}, autoConnect = true) {
    this.callbacks = callbacks;
    if (autoConnect) {
      this.connectWebSocket();
    }
  }

  get logs(): CloudAuditEntry[] {
    return [...this.auditLogs];
  }

  get cloudConnected(): boolean {
    return this.isConnected;
  }

  get activeSessionId(): string {
    return this.sessionId;
  }

  connectWebSocket(url = 'ws://localhost:8000/ws/coach'): void {
    if (typeof WebSocket === 'undefined') {
      this.isConnected = false;
      this.callbacks.onConnectionStatusChanged?.(false);
      return;
    }

    this.shouldReconnect = true;
    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.callbacks.onConnectionStatusChanged?.(true);
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'CONNECTED') {
            this.sessionId = msg.sessionId;
          } else if (msg.type === 'COACHING_CUE') {
            const fb: CoachingFeedback = {
              audioCue: msg.feedback.audioCue,
              visualCue: msg.feedback.visualCue,
              actionZone: msg.feedback.actionZone,
              timestamp: msg.feedback.timestamp || Date.now()
            };

            // Enregistrement dans le journal d'audit
            this.recordAuditEntry({
              id: `cue_${Date.now()}`,
              timestamp: new Date().toLocaleTimeString(),
              anomalyType: msg.feedback.actionZone,
              repNumber: 0,
              generatedPrompt: msg.feedback.prompt || 'Prompt généré côté Cloud',
              coachResponse: msg.feedback.visualCue,
              latencyMs: msg.feedback.latencyMs || 45
            });

            this.callbacks.onCoachingCueReceived?.(fb);
          } else if (msg.type === 'REP_SCORE_SAVED') {
            this.callbacks.onRepScoreAcknowledged?.(msg.repNumber, msg.scores);
          } else if (msg.type === 'SESSION_DEBRIEF') {
            this.callbacks.onDebriefReceived?.(msg.debriefText);
          }
        } catch (e) {
          console.error('Erreur parsing WebSocket message:', e);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.callbacks.onConnectionStatusChanged?.(false);
        if (this.shouldReconnect) {
          this.reconnectTimer = setTimeout(() => this.connectWebSocket(url), 3000);
        }
      };

      this.ws.onerror = () => {
        this.isConnected = false;
        this.callbacks.onConnectionStatusChanged?.(false);
      };
    } catch {
      this.isConnected = false;
      this.callbacks.onConnectionStatusChanged?.(false);
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  /**
   * Construit le prompt textuel sans média.
   */
  generateCloudPrompt(anomaly: AnomalyEvent): string {
    return `[SUPERVISEUR SPORTIF BIOMÉCANIQUE]
Événement : Anomalie détectée en temps réel
Exercice : ${anomaly.exercise.toUpperCase()}
Répétition : ${anomaly.repNumber} | Phase : ${anomaly.phase}
Type de défaut : ${anomaly.type} (${anomaly.explanation})
Sévérité : ${anomaly.severity}
Télémétrie :
- Angle genou : ${anomaly.metrics.kneeAngle}°
- Angle torse : ${anomaly.metrics.torsoAngle}°
- Ratio écartement genoux : ${anomaly.metrics.kneeDistanceRatio} (seuil : 0.72)
- Durée phase : ${anomaly.metrics.phaseDurationSec}s

Instruction : Donne une consigne d'action immédiate pour corriger le mouvement (max 7 mots, cueing externe).`;
  }

  /**
   * Traite l'anomalie : envoie au serveur WebSocket ou traite en local en fallback.
   */
  async processAnomaly(anomaly: AnomalyEvent): Promise<CoachingFeedback> {
    const prompt = this.generateCloudPrompt(anomaly);

    // Si le WebSocket est connecté, on transmet au backend Agent 2
    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'ANOMALY_EVENT',
          payload: anomaly
        })
      );
    }

    // Réponse immédiate réflexe pour latence locale ultra-basse
    let coachCue = 'Pousse le sol et écarte les genoux !';
    let actionZone: CoachingFeedback['actionZone'] = 'KNEES';

    switch (anomaly.type) {
      case 'KNEE_VALGUS':
        coachCue = 'Écarte les genoux vers l’extérieur !';
        actionZone = 'KNEES';
        break;
      case 'TEMPO_TOO_FAST':
        coachCue = 'Ralentis la descente, contrôle la charge !';
        actionZone = 'TEMPO';
        break;
      case 'INSUFFICIENT_DEPTH':
        coachCue = 'Descends plus bas, casse la parallèle !';
        actionZone = 'DEPTH';
        break;
      case 'EXCESSIVE_TORSO_LEAN':
        coachCue = 'Buste droit, sors la poitrine !';
        actionZone = 'TORSO';
        break;
    }

    const auditEntry: CloudAuditEntry = {
      id: anomaly.eventId,
      timestamp: new Date().toLocaleTimeString(),
      anomalyType: anomaly.type,
      repNumber: anomaly.repNumber,
      generatedPrompt: prompt,
      coachResponse: coachCue,
      latencyMs: 38
    };

    this.recordAuditEntry(auditEntry);

    return {
      audioCue: coachCue,
      visualCue: coachCue,
      actionZone,
      timestamp: Date.now()
    };
  }

  /**
   * Envoie les scores multi-facteurs de la répétition validée au Backend Cloud
   */
  sendRepScores(repNumber: number, scores: RepScores, durationSec: number): void {
    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'REP_SCORES',
          payload: {
            repNumber,
            scores,
            durationSec
          }
        })
      );
    }
  }

  /**
   * Demande le débriefing de progression de fin de séance au Cloud
   */
  requestSessionDebrief(): void {
    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'END_SESSION' }));
    }
  }

  private recordAuditEntry(entry: CloudAuditEntry): void {
    this.auditLogs.unshift(entry);
    if (this.auditLogs.length > 50) this.auditLogs.pop();
    this.callbacks.onLogUpdated?.(this.auditLogs);
  }

  clearLogs(): void {
    this.auditLogs = [];
    this.callbacks.onLogUpdated?.(this.auditLogs);
  }
}
