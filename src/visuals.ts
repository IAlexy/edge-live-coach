import { Point3D, KinematicMetrics, AnomalyEvent } from './types';
import { POSE_LANDMARKS } from './kinematics';

const SKELETON_CONNECTIONS = [
  // Épaules et Torse
  [POSE_LANDMARKS.LEFT_SHOULDER, POSE_LANDMARKS.RIGHT_SHOULDER],
  [POSE_LANDMARKS.LEFT_SHOULDER, POSE_LANDMARKS.LEFT_HIP],
  [POSE_LANDMARKS.RIGHT_SHOULDER, POSE_LANDMARKS.RIGHT_HIP],
  [POSE_LANDMARKS.LEFT_HIP, POSE_LANDMARKS.RIGHT_HIP],
  // Membres inférieurs
  [POSE_LANDMARKS.LEFT_HIP, POSE_LANDMARKS.LEFT_KNEE],
  [POSE_LANDMARKS.RIGHT_HIP, POSE_LANDMARKS.RIGHT_KNEE],
  [POSE_LANDMARKS.LEFT_KNEE, POSE_LANDMARKS.LEFT_ANKLE],
  [POSE_LANDMARKS.RIGHT_KNEE, POSE_LANDMARKS.RIGHT_ANKLE],
];

export class VisualRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private activeAnomaly: AnomalyEvent | null = null;
  private anomalyVisualEndTime = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) throw new Error("Impossible d'obtenir le contexte 2D");
    this.ctx = context;
  }

  setAnomalyHighlight(anomaly: AnomalyEvent | null, durationMs = 2400): void {
    this.activeAnomaly = anomaly;
    this.anomalyVisualEndTime = performance.now() + durationMs;
  }

  render(
    videoElement: HTMLVideoElement | null,
    landmarks: Point3D[] | null,
    metrics: KinematicMetrics | null
  ): void {
    const { ctx, canvas } = this;
    const width = canvas.width;
    const height = canvas.height;
    const now = performance.now();

    const isAnomalyActive = this.activeAnomaly !== null && now < this.anomalyVisualEndTime;

    ctx.clearRect(0, 0, width, height);

    // 1. Fond : Vidéo ou fond sombre contrasté
    if (videoElement && videoElement.readyState >= 2) {
      // Effet miroir pour un retour naturel comme un miroir de gym
      ctx.save();
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(videoElement, 0, 0, width, height);
      ctx.restore();

      // Voile sombre pour augmenter le contraste visuel
      ctx.fillStyle = 'rgba(10, 15, 26, 0.45)';
      ctx.fillRect(0, 0, width, height);
    } else {
      ctx.fillStyle = '#0a0f1a';
      ctx.fillRect(0, 0, width, height);
    }

    // 2. Flash périphérique d'alerte (Accessibilité Malentendants)
    if (isAnomalyActive) {
      ctx.save();
      const pulse = (Math.sin(now / 120) + 1) / 2;
      ctx.strokeStyle = `rgba(255, 59, 48, ${0.4 + pulse * 0.5})`;
      ctx.lineWidth = 14;
      ctx.strokeRect(0, 0, width, height);
      ctx.restore();
    }

    if (!landmarks || landmarks.length === 0) return;

    // Fonction de conversion normalisé (0-1) -> coordonnées pixels (avec miroir X)
    const toPx = (p: Point3D): { x: number; y: number } => {
      // En mode miroir
      return {
        x: (1 - p.x) * width,
        y: p.y * height
      };
    };

    // 3. Dessin des liaisons du squelette
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const [idxA, idxB] of SKELETON_CONNECTIONS) {
      const pA = landmarks[idxA];
      const pB = landmarks[idxB];
      if (!pA || !pB) continue;

      const posA = toPx(pA);
      const posB = toPx(pB);

      let lineColor = '#00FF88'; // Vert néon haute visibilité
      let lineWidth = 6;

      if (isAnomalyActive) {
        if (
          this.activeAnomaly?.type === 'KNEE_VALGUS' &&
          (idxA === POSE_LANDMARKS.LEFT_KNEE || idxB === POSE_LANDMARKS.LEFT_KNEE ||
           idxA === POSE_LANDMARKS.RIGHT_KNEE || idxB === POSE_LANDMARKS.RIGHT_KNEE)
        ) {
          lineColor = '#FF3B30'; // Rouge vif d'anomalie
          lineWidth = 8;
        } else if (
          this.activeAnomaly?.type === 'EXCESSIVE_TORSO_LEAN' &&
          (idxA === POSE_LANDMARKS.LEFT_SHOULDER || idxB === POSE_LANDMARKS.LEFT_SHOULDER)
        ) {
          lineColor = '#FF9500';
          lineWidth = 8;
        }
      }

      ctx.beginPath();
      ctx.moveTo(posA.x, posA.y);
      ctx.lineTo(posB.x, posB.y);
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }

    // 4. Dessin des articulations (Keypoints)
    const keypointIndices = new Set<number>(Object.values(POSE_LANDMARKS));
    for (let i = 0; i < landmarks.length; i++) {
      if (!keypointIndices.has(i)) continue;
      const pt = landmarks[i];
      const pos = toPx(pt);

      let jointColor = '#FFFFFF';
      let jointRadius = 7;

      const isKnee = i === POSE_LANDMARKS.LEFT_KNEE || i === POSE_LANDMARKS.RIGHT_KNEE;
      const isValgusAlert = isAnomalyActive && this.activeAnomaly?.type === 'KNEE_VALGUS' && isKnee;

      if (isValgusAlert) {
        jointColor = '#FF3B30';
        jointRadius = 12;

        // Anneau pulsant d'alerte autour du genou
        ctx.save();
        const haloPulse = (Math.sin(now / 100) + 1) * 8;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 22 + haloPulse, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 59, 48, 0.8)';
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.restore();
      }

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, jointRadius, 0, Math.PI * 2);
      ctx.fillStyle = jointColor;
      ctx.fill();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 5. Affichage dynamique des métriques sur le squelette
    if (metrics) {
      const lKnee = toPx(landmarks[POSE_LANDMARKS.LEFT_KNEE]);
      const rKnee = toPx(landmarks[POSE_LANDMARKS.RIGHT_KNEE]);

      // Angle du genou affiché à proximité
      ctx.font = 'bold 16px "Inter", "Segoe UI", sans-serif';
      ctx.fillStyle = '#00FF88';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 3;

      const kneeText = `${metrics.kneeAngle}°`;
      ctx.strokeText(kneeText, lKnee.x + 18, lKnee.y);
      ctx.fillText(kneeText, lKnee.x + 18, lKnee.y);

      // Flèches correctives visuelles en cas de valgus (pousser vers l'extérieur)
      if (isAnomalyActive && this.activeAnomaly?.type === 'KNEE_VALGUS') {
        this.drawOutwardArrow(ctx, lKnee.x, lKnee.y, true);
        this.drawOutwardArrow(ctx, rKnee.x, rKnee.y, false);
      }
    }
  }

  private drawOutwardArrow(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    pointsRight: boolean
  ): void {
    ctx.save();
    ctx.strokeStyle = '#FFCC00';
    ctx.fillStyle = '#FFCC00';
    ctx.lineWidth = 4;

    const dir = pointsRight ? 1 : -1;
    const startX = x + dir * 25;
    const endX = x + dir * 65;

    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(endX, y);
    ctx.lineTo(endX - dir * 12, y - 8);
    ctx.lineTo(endX - dir * 12, y + 8);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }
}
