export interface Point3D {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

export type SquatPhase = 'IDLE' | 'DESCENT' | 'BOTTOM' | 'ASCENT' | 'COMPLETED';

export type AnomalyType = 
  | 'KNEE_VALGUS' 
  | 'TEMPO_TOO_FAST' 
  | 'INSUFFICIENT_DEPTH' 
  | 'EXCESSIVE_TORSO_LEAN';

export interface KinematicMetrics {
  kneeAngle: number;
  leftKneeAngle: number;
  rightKneeAngle: number;
  hipAngle: number;
  torsoAngle: number;
  kneeDistanceRatio: number;
  phase: SquatPhase;
  phaseDuration: number;
  repCount: number;
  timestamp: number;
}

export interface AnomalyEvent {
  eventId: string;
  timestamp: number;
  exercise: 'squat';
  repNumber: number;
  phase: SquatPhase;
  type: AnomalyType;
  severity: 'MODERATE' | 'HIGH' | 'CRITICAL';
  metrics: {
    kneeAngle: number;
    torsoAngle: number;
    kneeDistanceRatio: number;
    phaseDurationSec: number;
  };
  explanation: string;
}

export interface RepScores {
  stability: number; // 0 - 100 : alignement et absence de valgus
  tempo: number;     // 0 - 100 : contrôle de la vitesse d'excentrique (~3s)
  depth: number;     // 0 - 100 : amplitude et descente sous la parallèle (<= 95°)
  posture: number;   // 0 - 100 : verticalité et gainage du buste
  global: number;    // 0 - 100 : moyenne pondérée
}

export interface CloudAuditEntry {
  id: string;
  timestamp: string;
  anomalyType: AnomalyType | string;
  repNumber: number;
  generatedPrompt: string;
  coachResponse: string;
  latencyMs: number;
}

export interface CoachingFeedback {
  audioCue: string;
  visualCue: string;
  actionZone: 'KNEES' | 'TEMPO' | 'DEPTH' | 'TORSO' | 'NONE';
  timestamp: number;
}
