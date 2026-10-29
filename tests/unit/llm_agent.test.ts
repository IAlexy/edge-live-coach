import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CloudCoachAgent, AnomalyPayload } from '../../backend/llm_agent';
import { resetDatabase, upsertSession, insertRepScore } from '../../backend/db';

function makePayload(overrides: Partial<AnomalyPayload> = {}): AnomalyPayload {
  return {
    eventId: 'evt_test_1',
    sessionId: 'ses_test_1',
    timestamp: Date.now(),
    exercise: 'squat',
    repNumber: 3,
    phase: 'DESCENT',
    type: 'KNEE_VALGUS',
    severity: 'HIGH',
    metrics: {
      kneeAngle: 92,
      torsoAngle: 22,
      kneeDistanceRatio: 0.61,
      phaseDurationSec: 2.1
    },
    explanation: 'Genoux rentrant vers l’intérieur',
    ...overrides
  };
}

describe('CloudCoachAgent (Unit Tests)', () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a strict Zero-Media text prompt with telemetry and optional fatigue context', () => {
    const agent = new CloudCoachAgent(null);
    const promptNormal = agent.buildAnomalyPrompt(makePayload());

    expect(promptNormal).toContain('[SUPERVISEUR SPORTIF BIOMÉCANIQUE EN DIRECT]');
    expect(promptNormal).toContain('KNEE_VALGUS');
    expect(promptNormal).toContain('Angle du genou : 92°');
    expect(promptNormal).not.toContain('Signe de fatigue détecté');

    const promptFatigue = agent.buildAnomalyPrompt(
      makePayload({
        recentTrend: { stabilityAvg: 58, fatigueDetected: true }
      })
    );
    expect(promptFatigue).toContain('Signe de fatigue détecté');
  });

  it('returns ultra-fast heuristic cues when no API key is configured', async () => {
    const agent = new CloudCoachAgent(null);

    const valgusRes = await agent.inferCorrection(makePayload({ type: 'KNEE_VALGUS' }));
    expect(valgusRes.actionZone).toBe('KNEES');
    expect(valgusRes.cueText).toContain('Pousse le sol');

    const valgusFatigueRes = await agent.inferCorrection(
      makePayload({
        type: 'KNEE_VALGUS',
        recentTrend: { stabilityAvg: 60, fatigueDetected: true }
      })
    );
    expect(valgusFatigueRes.cueText).toContain('Fatigue');

    const tempoRes = await agent.inferCorrection(makePayload({ type: 'TEMPO_TOO_FAST' }));
    expect(tempoRes.actionZone).toBe('TEMPO');
    expect(tempoRes.cueText).toContain('Ralentis');

    const depthRes = await agent.inferCorrection(makePayload({ type: 'INSUFFICIENT_DEPTH' }));
    expect(depthRes.actionZone).toBe('DEPTH');
    expect(depthRes.cueText).toContain('Descends plus bas');

    const torsoRes = await agent.inferCorrection(makePayload({ type: 'EXCESSIVE_TORSO_LEAN' }));
    expect(torsoRes.actionZone).toBe('TORSO');
    expect(torsoRes.cueText).toContain('Buste fier');
  });

  it('uses Gemini API response when apiKey is provided and falls back on network error', async () => {
    const agent = new CloudCoachAgent('fake-gemini-key');

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: '"Écarte fort le sol avec tes pieds !"' }]
            }
          }
        ]
      })
    } as Response);

    const res = await agent.inferCorrection(makePayload({ type: 'KNEE_VALGUS' }));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.cueText).toBe('Écarte fort le sol avec tes pieds !');

    // Simulate network failure -> should seamlessly fall back to heuristic engine
    fetchSpy.mockRejectedValueOnce(new Error('Network offline'));
    const fallbackRes = await agent.inferCorrection(makePayload({ type: 'TEMPO_TOO_FAST' }));
    expect(fallbackRes.cueText).toBe('Ralentis la descente, contrôle la charge !');
  });

  it('generates session debriefs reflecting volume, fatigue drop, and tempo mastery', async () => {
    const agent = new CloudCoachAgent(null);

    const emptyDebrief = await agent.generateSessionDebrief('non_existent');
    expect(emptyDebrief).toBe('Aucune répétition enregistrée pour cette session.');

    const sessionId = 'ses_debrief_1';
    upsertSession({
      id: sessionId,
      created_at: new Date().toISOString(),
      exercise: 'squat',
      total_reps: 0,
      avg_global_score: 0,
      avg_stability: 0,
      avg_tempo: 0,
      avg_depth: 0,
      avg_posture: 0
    });

    // Insert 6 reps where stability drops significantly on the last 3 reps (100 -> 60)
    const stabilities = [100, 95, 95, 65, 60, 55];
    stabilities.forEach((stab, idx) => {
      insertRepScore({
        id: `rep_${idx + 1}`,
        session_id: sessionId,
        rep_number: idx + 1,
        global_score: 85,
        stability_score: stab,
        tempo_score: 90,
        depth_score: 95,
        posture_score: 90,
        duration_sec: 3.1,
        created_at: new Date().toISOString()
      });
    });

    const debrief = await agent.generateSessionDebrief(sessionId);
    expect(debrief).toContain('6 répétitions analysées');
    expect(debrief).toContain('Dégradation de la stabilité des genoux');
    expect(debrief).toContain('Maîtrise excentrique solide');
  });
});
