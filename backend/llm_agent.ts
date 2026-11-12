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
  lang?: string;
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
    const isEnglish = payload.lang === 'en';

    if (isEnglish) {
      const trendNoteEn = payload.recentTrend?.fatigueDetected
        ? `\nEffort context: Fatigue sign detected on recent repetitions (stability degradation).`
        : '';

      return `[LIVE BIOMECHANICAL SPORTS SUPERVISOR]
Exercise: ${payload.exercise.toUpperCase()} (Repetition #${payload.repNumber}, Phase: ${payload.phase})
Anomaly observed: ${payload.type}
Detail: ${payload.explanation}
Severity: ${payload.severity}
Measured telemetry:
- Knee angle: ${payload.metrics.kneeAngle}°
- Torso angle: ${payload.metrics.torsoAngle}°
- Knee width ratio: ${payload.metrics.kneeDistanceRatio} (threshold: 0.72)
- Phase duration: ${payload.metrics.phaseDurationSec}s${trendNoteEn}

Objective: Provide an immediate corrective cue.
Strict constraints:
- Maximum 7 words
- External cueing focus (environment or floor focus, e.g. "Push the floor", "Spread your knees")
- Direct English and energetic sports coach tone
Reply ONLY with the raw coaching cue.`;
    }

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
   * Alias de compatibilité pour l'inférence de consigne du coach.
   */
  async inferCoachingCue(payload: AnomalyPayload): Promise<CoachInferenceResult> {
    return this.inferCorrection(payload);
  }

  /**
   * Effectue l'inférence via l'API Gemini ou le moteur biomécanique heuristique rapide.
   */
  async inferCorrection(payload: AnomalyPayload): Promise<CoachInferenceResult> {
    const startTime = performance.now();
    const prompt = this.buildAnomalyPrompt(payload);
    const isEnglish = payload.lang === 'en';

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
      if (isEnglish) {
        switch (payload.type) {
          case 'KNEE_VALGUS':
            cueText = payload.recentTrend?.fatigueDetected
              ? 'Fatigue: lock your knees outward!'
              : 'Push the floor and spread your knees!';
            break;
          case 'TEMPO_TOO_FAST':
            cueText = 'Slow down the descent, control the load!';
            break;
          case 'INSUFFICIENT_DEPTH':
            cueText = 'Go deeper, break parallel!';
            break;
          case 'EXCESSIVE_TORSO_LEAN':
            cueText = 'Chest up, keep your torso proud!';
            break;
          default:
            cueText = 'Maintain posture and control!';
        }
      } else {
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
  async generateSessionDebrief(sessionId: string, lang = 'fr'): Promise<string> {
    const isEnglish = lang === 'en';
    const reps = getSessionReps(sessionId);
    if (reps.length === 0) {
      return isEnglish
        ? 'No repetitions recorded for this session.'
        : 'Aucune répétition enregistrée pour cette session.';
    }

    const firstReps = reps.slice(0, 3);
    const lastReps = reps.slice(-3);

    const avgFirstStability =
      firstReps.reduce((acc, r) => acc + r.stability_score, 0) / firstReps.length;
    const avgLastStability =
      lastReps.reduce((acc, r) => acc + r.stability_score, 0) / lastReps.length;
    const stabilityDrop = Math.round(avgFirstStability - avgLastStability);

    const avgTempo = Math.round(reps.reduce((acc, r) => acc + r.tempo_score, 0) / reps.length);

    if (isEnglish) {
      let debriefEn = `📊 SESSION PROGRESSION DEBRIEF:\n`;
      debriefEn += `• Volume: ${reps.length} repetitions analyzed.\n`;

      if (stabilityDrop > 15) {
        debriefEn += `• Fatigue evolution: Knee stability dropped by ${stabilityDrop}% at the end of the set. Plan glute/abductor strengthening.\n`;
      } else {
        debriefEn += `• Consistency: Excellent joint alignment stability throughout the set (+${Math.abs(stabilityDrop)}% variation).\n`;
      }

      debriefEn += `• Tempo Control: Average score of ${avgTempo}/100. ${
        avgTempo >= 80
          ? 'Solid eccentric mastery.'
          : 'Be careful not to rush the descent.'
      }`;

      return debriefEn;
    }

    let debrief = `📊 BILAN DE PROGRESSION DE LA SÉANCE :\n`;
    debrief += `• Volume : ${reps.length} répétitions analysées.\n`;

    if (stabilityDrop > 15) {
      debrief += `• Évolution de fatigue : Dégradation de la stabilité des genoux de ${stabilityDrop}% en fin de série. Prévois un renforcement des fessiers/abducteurs.\n`;
    } else {
      debrief += `• Régularité : Excellente constance de l'alignement articulaire tout au long de la série (+${Math.abs(stabilityDrop)}% de variation).\n`;
    }

    debrief += `• Contrôle du Tempo : Score moyen de ${avgTempo}/100. ${
      avgTempo >= 80
        ? 'Maîtrise excentrique solide.'
        : 'Attention à ne pas précipiter la descente.'
    }`;

    return debrief;
  }
}
