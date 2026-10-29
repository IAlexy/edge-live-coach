import { Point3D, KinematicMetrics, SquatPhase } from './types';

// MediaPipe landmark constants
export const POSE_LANDMARKS = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const;

/**
 * Calcule l'angle (en degrés) formé par trois points avec B comme sommet.
 */
export function calculateAngle(a: Point3D, b: Point3D, c: Point3D): number {
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs((radians * 180.0) / Math.PI);
  if (angle > 180.0) {
    angle = 360.0 - angle;
  }
  return Math.round(angle * 10) / 10;
}

/**
 * Calcule l'angle du buste par rapport à la verticale (0° = vertical droit).
 */
export function calculateTorsoAngle(shoulderMid: Point3D, hipMid: Point3D): number {
  const dx = shoulderMid.x - hipMid.x;
  const dy = hipMid.y - shoulderMid.y; // Inversion car Y va vers le bas à l'écran
  const radians = Math.atan2(Math.abs(dx), dy);
  const angle = (radians * 180.0) / Math.PI;
  return Math.round(angle * 10) / 10;
}

/**
 * Filtre exponentiel léger pour réduire le bruit (jitter) de détection.
 */
export class ExponentialFilter {
  private value: number | null = null;
  private alpha: number;

  constructor(alpha = 0.35) {
    this.alpha = alpha;
  }

  filter(val: number): number {
    if (this.value === null) {
      this.value = val;
    } else {
      this.value = this.alpha * val + (1 - this.alpha) * this.value;
    }
    return Math.round(this.value * 10) / 10;
  }

  reset(): void {
    this.value = null;
  }
}

/**
 * Moteur d'extraction des invariants cinématiques à partir des 33 repères 3D.
 */
export class KinematicsEngine {
  private leftKneeFilter = new ExponentialFilter(0.4);
  private rightKneeFilter = new ExponentialFilter(0.4);
  private torsoFilter = new ExponentialFilter(0.3);
  private valgusFilter = new ExponentialFilter(0.3);

  reset(): void {
    this.leftKneeFilter.reset();
    this.rightKneeFilter.reset();
    this.torsoFilter.reset();
    this.valgusFilter.reset();
  }

  extractMetrics(
    landmarks: Point3D[],
    currentPhase: SquatPhase,
    phaseDuration: number,
    repCount: number
  ): KinematicMetrics | null {
    if (!landmarks || landmarks.length < 29) return null;

    const lShoulder = landmarks[POSE_LANDMARKS.LEFT_SHOULDER];
    const rShoulder = landmarks[POSE_LANDMARKS.RIGHT_SHOULDER];
    const lHip = landmarks[POSE_LANDMARKS.LEFT_HIP];
    const rHip = landmarks[POSE_LANDMARKS.RIGHT_HIP];
    const lKnee = landmarks[POSE_LANDMARKS.LEFT_KNEE];
    const rKnee = landmarks[POSE_LANDMARKS.RIGHT_KNEE];
    const lAnkle = landmarks[POSE_LANDMARKS.LEFT_ANKLE];
    const rAnkle = landmarks[POSE_LANDMARKS.RIGHT_ANKLE];

    // Vérifier la visibilité minimale si présente
    const isVisible = (p: Point3D) => (p.visibility ?? 1) > 0.4;
    if (!isVisible(lKnee) && !isVisible(rKnee)) return null;

    // 1. Angles des genoux (Hanche - Genou - Cheville)
    const rawLeftKnee = calculateAngle(lHip, lKnee, lAnkle);
    const rawRightKnee = calculateAngle(rHip, rKnee, rAnkle);
    const leftKneeAngle = this.leftKneeFilter.filter(rawLeftKnee);
    const rightKneeAngle = this.rightKneeFilter.filter(rawRightKnee);
    const kneeAngle = Math.round(((leftKneeAngle + rightKneeAngle) / 2) * 10) / 10;

    // 2. Angle de flexion de hanche (Épaule - Hanche - Genou)
    const hipAngle = Math.round(
      (calculateAngle(lShoulder, lHip, lKnee) + calculateAngle(rShoulder, rHip, rKnee)) / 2
    );

    // 3. Inclinaison du torse
    const shoulderMid: Point3D = {
      x: (lShoulder.x + rShoulder.x) / 2,
      y: (lShoulder.y + rShoulder.y) / 2
    };
    const hipMid: Point3D = {
      x: (lHip.x + rHip.x) / 2,
      y: (lHip.y + rHip.y) / 2
    };
    const rawTorso = calculateTorsoAngle(shoulderMid, hipMid);
    const torsoAngle = this.torsoFilter.filter(rawTorso);

    // 4. Ratio d'écartement des genoux (Détection du Valgus)
    // Mesure de la distance transversale (axe X)
    const kneeDist = Math.abs(lKnee.x - rKnee.x);
    const ankleDist = Math.abs(lAnkle.x - rAnkle.x);
    const hipDist = Math.abs(lHip.x - rHip.x);
    const baseDist = Math.max(ankleDist, hipDist, 0.05);
    const rawRatio = kneeDist / baseDist;
    const kneeDistanceRatio = Math.round(this.valgusFilter.filter(rawRatio) * 100) / 100;

    return {
      kneeAngle,
      leftKneeAngle,
      rightKneeAngle,
      hipAngle,
      torsoAngle,
      kneeDistanceRatio,
      phase: currentPhase,
      phaseDuration,
      repCount,
      timestamp: performance.now()
    };
  }
}
