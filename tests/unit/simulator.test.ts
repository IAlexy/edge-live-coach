import { describe, it, expect } from 'vitest';
import { GestureSimulator } from '../../src/simulator';
import { KinematicsEngine } from '../../src/kinematics';
import { SquatDetector } from '../../src/detector';
import { AnomalyType } from '../../src/types';

describe('GestureSimulator (Unit & Biomechanical Pipeline Tests)', () => {
  it('manages start, stop, and scenario states', () => {
    const sim = new GestureSimulator();
    expect(sim.running).toBe(false);
    expect(sim.scenario).toBe('NOMINAL');

    sim.start();
    expect(sim.running).toBe(true);

    sim.setScenario('KNEE_VALGUS');
    expect(sim.scenario).toBe('KNEE_VALGUS');

    sim.stop();
    expect(sim.running).toBe(false);
  });

  it('generates 33 3D landmarks with valid coordinates and visibility', () => {
    const sim = new GestureSimulator();
    sim.start();
    const frame = sim.generateFrame(0.1);
    expect(frame).toHaveLength(33);
    for (const pt of frame) {
      expect(pt.x).toBeGreaterThanOrEqual(0);
      expect(pt.x).toBeLessThanOrEqual(1);
      expect(pt.y).toBeGreaterThanOrEqual(0);
      expect(pt.y).toBeLessThanOrEqual(1);
      expect(pt.visibility).toBeGreaterThan(0.5);
    }
  });

  it('produces a valid rep with no anomalies in NOMINAL scenario', () => {
    const sim = new GestureSimulator();
    const kinematics = new KinematicsEngine();
    const detectedAnomalies: AnomalyType[] = [];
    let reps = 0;

    const detector = new SquatDetector({
      onAnomalyDetected: (a) => detectedAnomalies.push(a.type),
      onRepCompleted: (count) => {
        reps = count;
      }
    });

    sim.setScenario('NOMINAL');
    sim.start();

    let simTimeMs = 0;
    const stepSec = 0.05;
    // Run for 6 seconds (full cycle is 5.4s)
    for (let i = 0; i < 120; i++) {
      simTimeMs += stepSec * 1000;
      const landmarks = sim.generateFrame(stepSec);
      const metrics = kinematics.extractMetrics(
        landmarks,
        detector.currentPhase,
         simTimeMs,
        detector.currentRepCount
      );
      if (metrics) {
        metrics.timestamp = simTimeMs;
        detector.update(metrics);
      }
    }

    expect(reps).toBeGreaterThanOrEqual(1);
    expect(detectedAnomalies).toHaveLength(0);
  });

  it.each([
    ['KNEE_VALGUS', 'KNEE_VALGUS'],
    ['TEMPO_TOO_FAST', 'TEMPO_TOO_FAST'],
    ['INSUFFICIENT_DEPTH', 'INSUFFICIENT_DEPTH'],
    ['EXCESSIVE_TORSO_LEAN', 'EXCESSIVE_TORSO_LEAN']
  ] as const)('triggers %s anomaly when running scenario %s', (scenario, expectedAnomaly) => {
    const sim = new GestureSimulator();
    const kinematics = new KinematicsEngine();
    const detectedAnomalies: AnomalyType[] = [];

    const detector = new SquatDetector({
      onAnomalyDetected: (a) => detectedAnomalies.push(a.type)
    });

    sim.setScenario(scenario);
    sim.start();

    let simTimeMs = 0;
    const stepSec = 0.05;
    for (let i = 0; i < 120; i++) {
      simTimeMs += stepSec * 1000;
      const landmarks = sim.generateFrame(stepSec);
      const metrics = kinematics.extractMetrics(
        landmarks,
        detector.currentPhase,
        simTimeMs,
        detector.currentRepCount
      );
      if (metrics) {
        metrics.timestamp = simTimeMs;
        detector.update(metrics);
      }
    }

    expect(detectedAnomalies).toContain(expectedAnomaly);
  });
});
