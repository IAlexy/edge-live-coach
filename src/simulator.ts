import { Point3D } from './types';
import { POSE_LANDMARKS } from './kinematics';

export type SimulationScenario =
  | 'NOMINAL'
  | 'KNEE_VALGUS'
  | 'TEMPO_TOO_FAST'
  | 'INSUFFICIENT_DEPTH'
  | 'EXCESSIVE_TORSO_LEAN';

export class GestureSimulator {
  private activeScenario: SimulationScenario = 'NOMINAL';
  private cycleTime = 0; // en secondes
  private isRunning = false;

  setScenario(scenario: SimulationScenario): void {
    this.activeScenario = scenario;
    this.cycleTime = 0;
  }

  get scenario(): SimulationScenario {
    return this.activeScenario;
  }

  start(): void {
    this.isRunning = true;
    this.cycleTime = 0;
  }

  stop(): void {
    this.isRunning = false;
  }

  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Génère les 33 landmarks d'un corps humain en train de réaliser un squat.
   */
  generateFrame(deltaTimeSec: number): Point3D[] {
    // Durée totale du cycle selon le scénario
    const isFast = this.activeScenario === 'TEMPO_TOO_FAST';
    const eccentricDuration = isFast ? 0.65 : 3.0; // Descente en 0.65s (anomalie) vs 3.0s (nominal)
    const pauseDuration = 0.4;
    const concentricDuration = 1.2;
    const restDuration = 0.8;
    const totalCycle = eccentricDuration + pauseDuration + concentricDuration + restDuration;

    this.cycleTime = (this.cycleTime + deltaTimeSec) % totalCycle;

    // Progression du squat (0 = debout, 1 = tout en bas)
    let depthProgress = 0;

    if (this.cycleTime < eccentricDuration) {
      depthProgress = this.cycleTime / eccentricDuration;
    } else if (this.cycleTime < eccentricDuration + pauseDuration) {
      depthProgress = 1.0;
    } else if (this.cycleTime < eccentricDuration + pauseDuration + concentricDuration) {
      const t = (this.cycleTime - (eccentricDuration + pauseDuration)) / concentricDuration;
      depthProgress = 1.0 - t;
    } else {
      depthProgress = 0;
    }

    // Réduction de la profondeur si scénario 'INSUFFICIENT_DEPTH'
    const maxDepth = this.activeScenario === 'INSUFFICIENT_DEPTH' ? 0.74 : 1.0;
    const currentDepth = depthProgress * maxDepth;

    // Coordonnées de base (corps au centre de l'image 0..1)
    const centerX = 0.45;
    const hipBaseY = 0.48 + currentDepth * 0.17; // Le bassin descend vers la ligne des genoux
    const kneeBaseY = 0.68 + currentDepth * 0.02;
    const ankleY = 0.89;

    // Décalage sagittal (projection 3/4) pour restituer la flexion réaliste de l'angle Hanche-Genou-Cheville
    const flexionOffsetX = currentDepth * 0.11;

    // Écartement transversal des genoux
    let kneeWidth = 0.18; // écart normalisé standard
    if (this.activeScenario === 'KNEE_VALGUS' && currentDepth > 0.35) {
      // Les genoux s'effondrent vers l'intérieur
      kneeWidth = 0.08;
    }

    // Inclinaison du buste
    let torsoLeanOffset = currentDepth * 0.04; // Inclinaison naturelle légère (~10°)
    if (this.activeScenario === 'EXCESSIVE_TORSO_LEAN' && currentDepth > 0.25) {
      // Buste penche très fort vers l'avant (> 50°)
      torsoLeanOffset = 0.32 * currentDepth;
    }

    const shoulderY = 0.25 + currentDepth * 0.17;
    const shoulderWidth = 0.22;
    const hipWidth = 0.16;
    const ankleWidth = 0.2;

    // Initialisation des 33 points
    const landmarks: Point3D[] = Array.from({ length: 33 }, () => ({
      x: 0.5,
      y: 0.5,
      z: 0,
      visibility: 0.9
    }));

    // Tête
    landmarks[POSE_LANDMARKS.NOSE] = {
      x: centerX + flexionOffsetX + torsoLeanOffset,
      y: shoulderY - 0.12,
      visibility: 0.95
    };

    // Épaules
    landmarks[POSE_LANDMARKS.LEFT_SHOULDER] = {
      x: centerX - shoulderWidth / 2 + flexionOffsetX + torsoLeanOffset,
      y: shoulderY,
      visibility: 0.95
    };
    landmarks[POSE_LANDMARKS.RIGHT_SHOULDER] = {
      x: centerX + shoulderWidth / 2 + flexionOffsetX + torsoLeanOffset,
      y: shoulderY,
      visibility: 0.95
    };

    // Bassin / Hanches
    landmarks[POSE_LANDMARKS.LEFT_HIP] = {
      x: centerX - hipWidth / 2 + flexionOffsetX,
      y: hipBaseY,
      visibility: 0.95
    };
    landmarks[POSE_LANDMARKS.RIGHT_HIP] = {
      x: centerX + hipWidth / 2 + flexionOffsetX,
      y: hipBaseY,
      visibility: 0.95
    };

    // Genoux
    landmarks[POSE_LANDMARKS.LEFT_KNEE] = {
      x: centerX - kneeWidth / 2,
      y: kneeBaseY,
      visibility: 0.95
    };
    landmarks[POSE_LANDMARKS.RIGHT_KNEE] = {
      x: centerX + kneeWidth / 2,
      y: kneeBaseY,
      visibility: 0.95
    };

    // Chevilles
    landmarks[POSE_LANDMARKS.LEFT_ANKLE] = {
      x: centerX - ankleWidth / 2 + flexionOffsetX * 0.85,
      y: ankleY,
      visibility: 0.95
    };
    landmarks[POSE_LANDMARKS.RIGHT_ANKLE] = {
      x: centerX + ankleWidth / 2 + flexionOffsetX * 0.85,
      y: ankleY,
      visibility: 0.95
    };

    return landmarks;
  }
}
