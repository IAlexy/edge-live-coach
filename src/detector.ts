import { KinematicMetrics, SquatPhase, AnomalyEvent, AnomalyType, RepScores } from './types';

export interface DetectorCallbacks {
  onPhaseChange?: (newPhase: SquatPhase, repCount: number) => void;
  onAnomalyDetected?: (anomaly: AnomalyEvent) => void;
  onRepCompleted?: (repCount: number, durationSec: number, scores: RepScores) => void;
}

export class SquatDetector {
  private phase: SquatPhase = 'IDLE';
  private repCount = 0;
  private phaseStartTime = 0;
  private repStartTime = 0;
  private minKneeAngleInRep = 180;
  private maxTorsoAngleInRep = 0;
  private minValgusRatioInRep = 1.0;
  private lastAnomalyTime = -Infinity;
  private anomalyCooldownMs = 2800;
  private descentDurationMs = 0;

  private callbacks: DetectorCallbacks;

  public thresholds = {
    standKneeAngle: 155,
    startDescentAngle: 145,
    targetDepthAngle: 95,
    insufficientDepthThreshold: 112,
    minDescentDurationMs: 1200,
    valgusRatioThreshold: 0.72,
    maxTorsoLeanAngle: 48,
  };

  constructor(callbacks: DetectorCallbacks = {}) {
    this.callbacks = callbacks;
    this.phaseStartTime = performance.now();
  }

  get currentPhase(): SquatPhase {
    return this.phase;
  }

  get currentRepCount(): number {
    return this.repCount;
  }

  get activePhaseDuration(): number {
    return Math.max(0, performance.now() - this.phaseStartTime);
  }

  reset(): void {
    this.phase = 'IDLE';
    this.repCount = 0;
    this.minKneeAngleInRep = 180;
    this.maxTorsoAngleInRep = 0;
    this.minValgusRatioInRep = 1.0;
    this.lastAnomalyTime = -Infinity;
    this.descentDurationMs = 0;
    this.phaseStartTime = performance.now();
  }

  update(metrics: KinematicMetrics): void {
    const now = Number.isFinite(metrics.timestamp) ? metrics.timestamp : performance.now();
    const kneeAngle = metrics.kneeAngle;
    const torsoAngle = metrics.torsoAngle;
    const valgusRatio = metrics.kneeDistanceRatio;

    // Enregistrement des extrêmes pendant la répétition pour l'évaluation multi-facteurs
    if (this.phase !== 'IDLE' && this.phase !== 'COMPLETED') {
      if (kneeAngle < this.minKneeAngleInRep) this.minKneeAngleInRep = kneeAngle;
      if (torsoAngle > this.maxTorsoAngleInRep) this.maxTorsoAngleInRep = torsoAngle;
      if (valgusRatio < this.minValgusRatioInRep) this.minValgusRatioInRep = valgusRatio;
    }

    switch (this.phase) {
      case 'IDLE':
      case 'COMPLETED':
        if (kneeAngle < this.thresholds.startDescentAngle) {
          this.setPhase('DESCENT', now);
          this.repStartTime = now;
          this.minKneeAngleInRep = kneeAngle;
          this.maxTorsoAngleInRep = torsoAngle;
          this.minValgusRatioInRep = valgusRatio;
        }
        break;

      case 'DESCENT':
        if (torsoAngle > this.thresholds.maxTorsoLeanAngle) {
          this.triggerAnomaly('EXCESSIVE_TORSO_LEAN', metrics, 'Buste trop penché vers l’avant', now);
        }

        if (valgusRatio < this.thresholds.valgusRatioThreshold) {
          this.triggerAnomaly('KNEE_VALGUS', metrics, 'Genoux rentrant vers l’intérieur en descente', now);
        }

        if (
          kneeAngle <= this.thresholds.targetDepthAngle ||
          (kneeAngle > this.minKneeAngleInRep + 4 && this.minKneeAngleInRep < 125)
        ) {
          this.descentDurationMs = Math.max(0, now - this.phaseStartTime);

          if (this.descentDurationMs < this.thresholds.minDescentDurationMs) {
            this.triggerAnomaly(
              'TEMPO_TOO_FAST',
              { ...metrics, phaseDuration: this.descentDurationMs },
              `Descente trop brusque (${(this.descentDurationMs / 1000).toFixed(1)}s < 1.5s)`,
              now
            );
          }

          this.setPhase('BOTTOM', now);
        }
        break;

      case 'BOTTOM':
        if (kneeAngle > this.minKneeAngleInRep + 6) {
          if (this.minKneeAngleInRep > this.thresholds.insufficientDepthThreshold) {
            this.triggerAnomaly(
              'INSUFFICIENT_DEPTH',
              metrics,
              `Amplitude incomplète (point bas à ${this.minKneeAngleInRep}°)`,
              now
            );
          }
          this.setPhase('ASCENT', now);
        }
        break;

      case 'ASCENT':
        if (valgusRatio < this.thresholds.valgusRatioThreshold) {
          this.triggerAnomaly('KNEE_VALGUS', metrics, 'Affaissement des genoux vers l’intérieur à la remontée', now);
        }

        if (torsoAngle > this.thresholds.maxTorsoLeanAngle) {
          this.triggerAnomaly('EXCESSIVE_TORSO_LEAN', metrics, 'Buste trop incliné en phase de poussée', now);
        }

        if (kneeAngle >= this.thresholds.standKneeAngle) {
          this.repCount++;
          const repDurationSec = Math.round(((now - this.repStartTime) / 1000) * 10) / 10;

          // Calcul du score multi-facteurs de la répétition
          const scores = this.computeMultiFactorScores(this.descentDurationMs);

          this.setPhase('COMPLETED', now);
          this.callbacks.onRepCompleted?.(this.repCount, repDurationSec, scores);
        }
        break;
    }
  }

  /**
   * Calcule les scores sur 4 facteurs biomécaniques + score global
   */
  private computeMultiFactorScores(descentMs: number): RepScores {
    // 1. Facteur Stabilité (Valgus)
    let stability = 100;
    if (this.minValgusRatioInRep < 0.85) {
      stability = Math.max(
        20,
        Math.min(100, Math.round(((this.minValgusRatioInRep - 0.55) / 0.3) * 80 + 20))
      );
    }

    // 2. Facteur Tempo (Contrôle excentrique ~ 3s)
    let tempo = 100;
    if (descentMs < 1200) {
      tempo = 35;
    } else if (descentMs < 2500) {
      tempo = Math.round(((descentMs - 1200) / 1300) * 65 + 35);
    } else if (descentMs > 4000) {
      tempo = 75; // descente un peu trop lente
    }

    // 3. Facteur Amplitude (Profondeur)
    let depth = 100;
    if (this.minKneeAngleInRep > 90) {
      depth = Math.max(25, Math.min(100, Math.round(100 - (this.minKneeAngleInRep - 90) * 2.2)));
    }

    // 4. Facteur Posture (Maintien du tronc)
    let posture = 100;
    if (this.maxTorsoAngleInRep > 32) {
      posture = Math.max(25, Math.min(100, Math.round(100 - (this.maxTorsoAngleInRep - 32) * 2.5)));
    }

    // Score Global pondéré
    const global = Math.round(0.3 * stability + 0.25 * depth + 0.25 * tempo + 0.2 * posture);

    return {
      stability,
      tempo,
      depth,
      posture,
      global
    };
  }

  private setPhase(newPhase: SquatPhase, now: number): void {
    this.phase = newPhase;
    this.phaseStartTime = now;
    this.callbacks.onPhaseChange?.(newPhase, this.repCount);
  }

  private triggerAnomaly(
    type: AnomalyType,
    metrics: KinematicMetrics,
    explanation: string,
    now = performance.now()
  ): void {
    if (now - this.lastAnomalyTime < this.anomalyCooldownMs) return;
    this.lastAnomalyTime = now;

    let severity: AnomalyEvent['severity'] = 'MODERATE';
    if (type === 'KNEE_VALGUS' && metrics.kneeDistanceRatio < 0.6) severity = 'CRITICAL';
    else if (type === 'TEMPO_TOO_FAST' && (metrics.phaseDuration || 0) < 800) severity = 'HIGH';
    else if (type === 'EXCESSIVE_TORSO_LEAN' && metrics.torsoAngle > 55) severity = 'HIGH';

    const event: AnomalyEvent = {
      eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
      exercise: 'squat',
      repNumber: this.repCount + 1,
      phase: this.phase,
      type,
      severity,
      metrics: {
        kneeAngle: metrics.kneeAngle,
        torsoAngle: metrics.torsoAngle,
        kneeDistanceRatio: metrics.kneeDistanceRatio,
        phaseDurationSec: Math.round(((metrics.phaseDuration || 0) / 1000) * 10) / 10
      },
      explanation
    };

    this.callbacks.onAnomalyDetected?.(event);
  }
}
