// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  fr,
  en,
  t,
  setLocale,
  getLocale,
  getAvailableLocales,
  registerLocale,
  onLocaleChange,
  LOCALE_STORAGE_KEY
} from '../../src/i18n';
import { CloudCoachAgent, AnomalyPayload } from '../../backend/llm_agent';
import { resetDatabase, upsertSession, insertRepScore } from '../../backend/db';

function makePayload(overrides: Partial<AnomalyPayload> = {}): AnomalyPayload {
  return {
    eventId: 'evt_i18n_1',
    sessionId: 'ses_i18n_1',
    timestamp: Date.now(),
    exercise: 'squat',
    repNumber: 2,
    phase: 'DESCENT',
    type: 'KNEE_VALGUS',
    severity: 'HIGH',
    metrics: {
      kneeAngle: 94,
      torsoAngle: 20,
      kneeDistanceRatio: 0.62,
      phaseDurationSec: 1.9
    },
    explanation: 'Knees caving inward',
    ...overrides
  };
}

describe('Extensible i18n Architecture & Multi-Language Agent (Unit Tests)', () => {
  beforeEach(() => {
    localStorage.clear();
    setLocale('fr');
    resetDatabase();
  });

  it('maintains strict key parity between French (fr) and English (en) dictionaries', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());

    for (const key of Object.keys(fr)) {
      expect(fr[key].trim().length).toBeGreaterThan(0);
      expect(en[key].trim().length).toBeGreaterThan(0);
    }
  });

  it('translates keys with variable interpolation and safe fallback', () => {
    expect(getLocale()).toBe('fr');
    expect(t('hud.repValidated', { rep: 4, duration: 2.8, score: 92 })).toBe(
      'Répétition #4 validée (2.8s) — Score : 92%'
    );

    setLocale('en');
    expect(t('hud.repValidated', { rep: 4, duration: 2.8, score: 92 })).toBe(
      'Rep #4 completed (2.8s) — Score: 92%'
    );

    // Fallback to raw key when completely unknown
    expect(t('non.existent.key')).toBe('non.existent.key');
  });

  it('switches between FR and EN, persists to localStorage, and notifies listeners', () => {
    const observedLocales: string[] = [];
    const unsubscribe = onLocaleChange((loc) => observedLocales.push(loc));

    setLocale('en');
    expect(getLocale()).toBe('en');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    expect(document.documentElement.lang).toBe('en');

    setLocale('fr');
    expect(getLocale()).toBe('fr');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('fr');
    expect(document.documentElement.lang).toBe('fr');

    // Unknown locale safely falls back to 'fr'
    setLocale('unknown_lang');
    expect(getLocale()).toBe('fr');

    unsubscribe();
    expect(observedLocales).toEqual(['en', 'fr', 'fr']);
  });

  it('supports dynamic registration of new languages (e.g., Spanish es) via registerLocale', () => {
    registerLocale('es', {
      'header.title': 'Entrenador en Vivo Edge / Cloud',
      'phase.IDLE': 'LISTO',
      'hud.repValidated': 'Repetición #{rep} completada ({duration}s) — Puntuación: {score}%'
    });

    expect(getAvailableLocales()).toContain('es');

    setLocale('es');
    expect(getLocale()).toBe('es');
    expect(t('header.title')).toBe('Entrenador en Vivo Edge / Cloud');
    expect(t('phase.IDLE')).toBe('LISTO');
    expect(t('hud.repValidated', { rep: 5, duration: 3.1, score: 96 })).toBe(
      'Repetición #5 completada (3.1s) — Puntuación: 96%'
    );

    // Keys not overridden in 'es' safely fall back to default 'fr' dictionary
    expect(t('telemetry.kneeAngle')).toBe(fr['telemetry.kneeAngle']);
  });

  it('supports lang="en" in CloudCoachAgent for English reflex cues and session debriefs', async () => {
    const agent = new CloudCoachAgent(null);

    const valgusEn = await agent.inferCorrection(makePayload({ type: 'KNEE_VALGUS', lang: 'en' }));
    expect(valgusEn.actionZone).toBe('KNEES');
    expect(valgusEn.cueText).toContain('Push the floor');
    expect(valgusEn.prompt).toContain('[LIVE BIOMECHANICAL SPORTS SUPERVISOR]');

    const valgusFatigueEn = await agent.inferCoachingCue(
      makePayload({
        type: 'KNEE_VALGUS',
        lang: 'en',
        recentTrend: { stabilityAvg: 55, fatigueDetected: true }
      })
    );
    expect(valgusFatigueEn.cueText).toContain('Fatigue: lock your knees outward!');

    const tempoEn = await agent.inferCorrection(makePayload({ type: 'TEMPO_TOO_FAST', lang: 'en' }));
    expect(tempoEn.cueText).toContain('Slow down the descent');

    const depthEn = await agent.inferCorrection(
      makePayload({ type: 'INSUFFICIENT_DEPTH', lang: 'en' })
    );
    expect(depthEn.cueText).toContain('Go deeper');

    const torsoEn = await agent.inferCorrection(
      makePayload({ type: 'EXCESSIVE_TORSO_LEAN', lang: 'en' })
    );
    expect(torsoEn.cueText).toContain('Chest up');

    const emptyDebriefEn = await agent.generateSessionDebrief('missing_session', 'en');
    expect(emptyDebriefEn).toBe('No repetitions recorded for this session.');

    const sessionId = 'ses_en_debrief';
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

    [100, 95, 95, 60, 55, 50].forEach((stab, idx) => {
      insertRepScore({
        id: `rep_en_${idx + 1}`,
        session_id: sessionId,
        rep_number: idx + 1,
        global_score: 85,
        stability_score: stab,
        tempo_score: 92,
        depth_score: 95,
        posture_score: 90,
        duration_sec: 3.0,
        created_at: new Date().toISOString()
      });
    });

    const debriefEn = await agent.generateSessionDebrief(sessionId, 'en');
    expect(debriefEn).toContain('SESSION PROGRESSION DEBRIEF');
    expect(debriefEn).toContain('6 repetitions analyzed');
    expect(debriefEn).toContain('Knee stability dropped by');
    expect(debriefEn).toContain('Solid eccentric mastery');
  });
});
