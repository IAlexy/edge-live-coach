import { getSessionReps } from './db';

export interface AnomalyPayload {
  eventId: string;
  sessionId: string;
  timestamp: number;
  exercise: string;
  repNumber: number;
  phase: string;
  type: string;
  severity: string;
  metrics: {
    kneeAngle: number;
    torsoAngle: number;
    kneeDistanceRatio: number;
    phaseDurationSec: number;
  };
  explanation: string;
  recentTrend?: {
    stabilityAvg?: number;
    fatigueDetected?: boolean;
  };
}

export interface CoachInferenceResult {
  cueText: string;
  actionZone: 'KNEES' | 'TEMPO' | 'DEPTH' | 'TORSO';
  prompt: string;
  latencyMs: number;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

export class CloudCoachAgent {
  private apiKey: string | null;

  constructor(apiKey?: string | null) {
    this.apiKey =
      apiKey !== undefined
        ? apiKey
        : process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
  }

  /**
   * Construit le prompt textuel sans média.
   * Conforme ZÉRO VIDÉO / ZÉRO AUDIO.
   */
  buildAnomalyPrompt(payload: AnomalyPayload): string {
    const trendNote = payload.recentTrend?.fatigueDetected
      ? `\nContexte d'effort : Signe de fatigue détecté sur les dernières répétitions (dégradation de la stabilité).`
      : '';

    return `[SUPERVISEUR SPORTIF BIOMÉCANIQUE EN DIRECT]
Exercice : ${payload.exercise.toUpperCase()} (Répétition #${payload.repNumber}, Phase: ${payload.phase})
Anomalie constatée : ${payload.type}
Détail : ${payload.explanation}
Sévérité : ${payload.severity}
Télémétrie mesurée :
- Angle du genou : ${payload.metrics.kneeAngle}°
- Angle du torse : ${payload.metrics.torsoAngle}°
- Ratio écartement genoux : ${payload.metrics.kneeDistanceRatio} (seuil : 0.72)
- Durée de phase : ${payload.metrics.phaseDurationSec}s${trendNote}

Objectif : Fournis une consigne immédiate de correction.
Contraintes impératives :
- Maximum 7 mots
- Orientation "cueing externe" (focalisation sur l'environnement ou le sol, ex: "Pousse le sol", "Écarte les genoux")
- Français direct et ton énergique de coach sportif
Réponds UNIQUEMENT avec la consigne brute.`;
  }

  /**
   * Effectue l'inférence via l'API Gemini ou le moteur biomécanique heuristique rapide.
   */
  async inferCorrection(payload: AnomalyPayload): Promise<CoachInferenceResult> {
    const startTime = performance.now();
    const prompt = this.buildAnomalyPrompt(payload);

    let cueText = '';
    let actionZone: CoachInferenceResult['actionZone'] = 'KNEES';

    // Détermination de la zone d'action
    if (payload.type === 'KNEE_VALGUS') actionZone = 'KNEES';
    else if (payload.type === 'TEMPO_TOO_FAST') actionZone = 'TEMPO';
    else if (payload.type === 'INSUFFICIENT_DEPTH') actionZone = 'DEPTH';
    else if (payload.type === 'EXCESSIVE_TORSO_LEAN') actionZone = 'TORSO';

    // Si une clé API Gemini est disponible, appel direct du LLM Cloud
    if (this.apiKey) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              maxOutputTokens: 25,
              temperature: 0.3
            }
          })
        });

        if (res.ok) {
          const data = (await res.json()) as GeminiResponse;
          const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (candidateText) {
            cueText = candidateText.replace(/^"|"$/g, '').trim();
          }
        }
      } catch (err) {
        console.warn('Erreur appel Gemini Cloud, basculement sur le moteur réflexe :', err);
      }
    }

    // Fallback réflexe heuristique immédiat (< 5 ms)
    if (!cueText) {
      switch (payload.type) {
        case 'KNEE_VALGUS':
          cueText = payload.recentTrend?.fatigueDetected
            ? 'Fatigue : verrouille les genoux vers l’extérieur !'
            : 'Pousse le sol et écarte les genoux !';
          break;
        case 'TEMPO_TOO_FAST':
          cueText = 'Ralentis la descente, contrôle la charge !';
          break;
        case 'INSUFFICIENT_DEPTH':
          cueText = 'Descends plus bas, casse la parallèle !';
          break;
        case 'EXCESSIVE_TORSO_LEAN':
          cueText = 'Buste fier, sors la poitrine !';
          break;
        default:
          cueText = 'Garde la posture et contrôle !';
      }
    }

    const latencyMs = Math.round(performance.now() - startTime);

    return {
      cueText,
      actionZone,
      prompt,
      latencyMs
    };
  }

  /**
   * Synthèse de progression à la fin d'une séance (Bilan de session).
   */
  async generateSessionDebrief(sessionId: string): Promise<string> {
    const reps = getSessionReps(sessionId);
    if (reps.length === 0) return 'Aucune répétition enregistrée pour cette session.';

    const firstReps = reps.slice(0, 3);
    const lastReps = reps.slice(-3);

    const avgFirstStability =
      firstReps.reduce((acc, r) => acc + r.stability_score, 0) / firstReps.length;
    const avgLastStability =
      lastReps.reduce((acc, r) => acc + r.stability_score, 0) / lastReps.length;
    const stabilityDrop = Math.round(avgFirstStability - avgLastStability);

    let debrief = `📊 BILAN DE PROGRESSION DE LA SÉANCE :\n`;
    debrief += `• Volume : ${reps.length} répétitions analysées.\n`;

    if (stabilityDrop > 15) {
      debrief += `• Évolution de fatigue : Dégradation de la stabilité des genoux de ${stabilityDrop}% en fin de série. Prévois un renforcement des fessiers/abducteurs.\n`;
    } else {
      debrief += `• Régularité : Excellente constance de l'alignement articulaire tout au long de la série (+${Math.abs(stabilityDrop)}% de variation).\n`;
    }

    const avgTempo = Math.round(reps.reduce((acc, r) => acc + r.tempo_score, 0) / reps.length);
    debrief += `• Contrôle du Tempo : Score moyen de ${avgTempo}/100. ${
      avgTempo >= 80
        ? 'Maîtrise excentrique solide.'
        : 'Attention à ne pas précipiter la descente.'
    }`;

    return debrief;
  }
}
