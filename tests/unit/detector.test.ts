import { describe, it, expect, vi } from 'vitest';
import { SquatDetector } from '../../src/detector';
import { KinematicMetrics, AnomalyEvent, RepScores, SquatPhase } from '../../src/types';

function makeMetrics(
  overrides: Partial<KinematicMetrics> & { timestamp: number }
): KinematicMetrics {
  return {
    kneeAngle: 175,
    leftKneeAngle: 175,
    rightKneeAngle: 175,
    hipAngle: 170,
    torsoAngle: 15,
    kneeDistanceRatio: 0.95,
    phase: 'IDLE',
    phaseDuration: 0,
    repCount: 0,
    ...overrides
  };
}

describe('SquatDetector (Unit Tests)', () => {
  it('completes a full nominal squat cycle and computes 100% multi-factor scores', () => {
    const phases: SquatPhase[] = [];
    const anomalies: AnomalyEvent[] = [];
    let completedRep = 0;
    let completedScores: RepScores | null = null;

    const detector = new SquatDetector({
      onPhaseChange: (phase) => phases.push(phase),
      onAnomalyDetected: (a) => anomalies.push(a),
      onRepCompleted: (rep, _dur, scores) => {
        completedRep = rep;
        completedScores = scores;
      }
    });

    // 1. Standing IDLE -> Start DESCENT at t=1000ms (angle < 145)
    detector.update(makeMetrics({ kneeAngle: 140, timestamp: 1000 }));
    expect(detector.currentPhase).toBe('DESCENT');

    // 2. Mid-descent at t=2500ms
    detector.update(makeMetrics({ kneeAngle: 110, timestamp: 2500 }));
    expect(detector.currentPhase).toBe('DESCENT');

    // 3. Reach target depth (<= 95°) at t=3800ms (descent duration = 2800ms, ideal ~3s)
    detector.update(makeMetrics({ kneeAngle: 88, timestamp: 3800 }));
    expect(detector.currentPhase).toBe('BOTTOM');

    // 4. Start ASCENT (angle > minKneeAngle + 6 => > 94°) at t=4200ms
    detector.update(makeMetrics({ kneeAngle: 100, timestamp: 4200 }));
    expect(detector.currentPhase).toBe('ASCENT');

    // 5. Return to standing (>= 155°) at t=5200ms
    detector.update(makeMetrics({ kneeAngle: 165, timestamp: 5200 }));
    expect(detector.currentPhase).toBe('COMPLETED');
    expect(completedRep).toBe(1);
    expect(anomalies).toHaveLength(0);
    expect(phases).toEqual(['DESCENT', 'BOTTOM', 'ASCENT', 'COMPLETED']);

    expect(completedScores).toEqual({
      stability: 100,
      tempo: 100,
      depth: 100,
      posture: 100,
      global: 100
    });
  });

  it('detects KNEE_VALGUS anomaly with CRITICAL severity when ratio < 0.60', () => {
    const onAnomaly = vi.fn();
    const detector = new SquatDetector({ onAnomalyDetected: onAnomaly });

    detector.update(makeMetrics({ kneeAngle: 140, timestamp: 1000 }));
    detector.update(
      makeMetrics({
        kneeAngle: 115,
        kneeDistanceRatio: 0.55,
        timestamp: 5000
      })
    );

    expect(onAnomaly).toHaveBeenCalledTimes(1);
    const event: AnomalyEvent = onAnomaly.mock.calls[0][0];
    expect(event.type).toBe('KNEE_VALGUS');
    expect(event.severity).toBe('CRITICAL');
  });

  it('detects TEMPO_TOO_FAST when descent duration is under 1200ms', () => {
    const onAnomaly = vi.fn();
    const detector = new SquatDetector({ onAnomalyDetected: onAnomaly });

    // Start descent at t=1000ms
    detector.update(makeMetrics({ kneeAngle: 140, timestamp: 1000 }));
    // Hit bottom at t=1600ms (600ms descent < 800ms => HIGH severity)
    detector.update(makeMetrics({ kneeAngle: 90, timestamp: 1600 }));

    expect(onAnomaly).toHaveBeenCalledTimes(1);
    const event: AnomalyEvent = onAnomaly.mock.calls[0][0];
    expect(event.type).toBe('TEMPO_TOO_FAST');
    expect(event.severity).toBe('HIGH');
  });

  it('detects INSUFFICIENT_DEPTH when user reverses above 112 degrees', () => {
    const onAnomaly = vi.fn();
    const detector = new SquatDetector({ onAnomalyDetected: onAnomaly });

    // Start descent at t=1000ms
    detector.update(makeMetrics({ kneeAngle: 140, timestamp: 1000 }));
    // Shallow dip to 118 degrees at t=2500ms
    detector.update(makeMetrics({ kneeAngle: 118, timestamp: 2500 }));
    // Reverse upward to 124 degrees (> 118 + 4) at t=3000ms -> enters BOTTOM
    detector.update(makeMetrics({ kneeAngle: 124, timestamp: 3000 }));
    expect(detector.currentPhase).toBe('BOTTOM');

    // Continue upward to 130 degrees (> 118 + 6) at t=4000ms -> triggers INSUFFICIENT_DEPTH and enters ASCENT
    detector.update(makeMetrics({ kneeAngle: 130, timestamp: 4000 }));
    expect(detector.currentPhase).toBe('ASCENT');
    expect(onAnomaly).toHaveBeenCalledTimes(1);
    expect(onAnomaly.mock.calls[0][0].type).toBe('INSUFFICIENT_DEPTH');
  });

  it('detects EXCESSIVE_TORSO_LEAN when torsoAngle exceeds 48 degrees', () => {
    const onAnomaly = vi.fn();
    const detector = new SquatDetector({ onAnomalyDetected: onAnomaly });

    detector.update(makeMetrics({ kneeAngle: 140, timestamp: 1000 }));
    detector.update(makeMetrics({ kneeAngle: 110, torsoAngle: 58, timestamp: 5000 }));

    expect(onAnomaly).toHaveBeenCalledTimes(1);
    const event: AnomalyEvent = onAnomaly.mock.calls[0][0];
    expect(event.type).toBe('EXCESSIVE_TORSO_LEAN');
    expect(event.severity).toBe('HIGH');
  });

  it('enforces anomaly cooldown (2800ms) to avoid spamming alerts', () => {
    const onAnomaly = vi.fn();
    const detector = new SquatDetector({ onAnomalyDetected: onAnomaly });

    detector.update(makeMetrics({ kneeAngle: 140, timestamp: 1000 }));
    detector.update(makeMetrics({ kneeAngle: 120, kneeDistanceRatio: 0.65, timestamp: 4000 }));
    // Within 2800ms cooldown -> should not trigger again
    detector.update(makeMetrics({ kneeAngle: 110, kneeDistanceRatio: 0.65, timestamp: 5000 }));
    expect(onAnomaly).toHaveBeenCalledTimes(1);

    // After 2800ms cooldown -> triggers again
    detector.update(makeMetrics({ kneeAngle: 105, kneeDistanceRatio: 0.65, timestamp: 7000 }));
    expect(onAnomaly).toHaveBeenCalledTimes(2);
  });

  it('resets state cleanly when reset() is called', () => {
    const detector = new SquatDetector();
    detector.update(makeMetrics({ kneeAngle: 130, timestamp: 1000 }));
    expect(detector.currentPhase).toBe('DESCENT');

    detector.reset();
    expect(detector.currentPhase).toBe('IDLE');
    expect(detector.currentRepCount).toBe(0);
  });
});
