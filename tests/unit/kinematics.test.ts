import { describe, it, expect } from 'vitest';
import {
  calculateAngle,
  calculateTorsoAngle,
  ExponentialFilter,
  KinematicsEngine,
  POSE_LANDMARKS
} from '../../src/kinematics';
import { Point3D } from '../../src/types';

function createBaseLandmarks(): Point3D[] {
  const landmarks: Point3D[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0.95
  }));

  landmarks[POSE_LANDMARKS.LEFT_SHOULDER] = { x: 0.4, y: 0.25, visibility: 0.95 };
  landmarks[POSE_LANDMARKS.RIGHT_SHOULDER] = { x: 0.6, y: 0.25, visibility: 0.95 };
  landmarks[POSE_LANDMARKS.LEFT_HIP] = { x: 0.4, y: 0.5, visibility: 0.95 };
  landmarks[POSE_LANDMARKS.RIGHT_HIP] = { x: 0.6, y: 0.5, visibility: 0.95 };
  landmarks[POSE_LANDMARKS.LEFT_KNEE] = { x: 0.4, y: 0.7, visibility: 0.95 };
  landmarks[POSE_LANDMARKS.RIGHT_KNEE] = { x: 0.6, y: 0.7, visibility: 0.95 };
  landmarks[POSE_LANDMARKS.LEFT_ANKLE] = { x: 0.4, y: 0.9, visibility: 0.95 };
  landmarks[POSE_LANDMARKS.RIGHT_ANKLE] = { x: 0.6, y: 0.9, visibility: 0.95 };

  return landmarks;
}

describe('Kinematics Module (Unit Tests)', () => {
  describe('calculateAngle', () => {
    it('computes 180 degrees for three collinear vertical points', () => {
      const a: Point3D = { x: 0.5, y: 0.2 };
      const b: Point3D = { x: 0.5, y: 0.5 };
      const c: Point3D = { x: 0.5, y: 0.8 };
      expect(calculateAngle(a, b, c)).toBe(180);
    });

    it('computes 90 degrees for a right angle joint', () => {
      const a: Point3D = { x: 0.5, y: 0.2 };
      const b: Point3D = { x: 0.5, y: 0.5 };
      const c: Point3D = { x: 0.8, y: 0.5 };
      expect(calculateAngle(a, b, c)).toBe(90);
    });

    it('normalizes angles greater than 180 degrees into [0, 180]', () => {
      const a: Point3D = { x: 0.2, y: 0.5 };
      const b: Point3D = { x: 0.5, y: 0.5 };
      const c: Point3D = { x: 0.5, y: 0.2 };
      expect(calculateAngle(a, b, c)).toBe(90);
    });
  });

  describe('calculateTorsoAngle', () => {
    it('returns 0 degrees when shoulders are vertically aligned above hips', () => {
      const shoulderMid: Point3D = { x: 0.5, y: 0.25 };
      const hipMid: Point3D = { x: 0.5, y: 0.55 };
      expect(calculateTorsoAngle(shoulderMid, hipMid)).toBe(0);
    });

    it('returns 45 degrees when torso leans forward equally on X and Y', () => {
      const shoulderMid: Point3D = { x: 0.7, y: 0.35 };
      const hipMid: Point3D = { x: 0.5, y: 0.55 };
      expect(calculateTorsoAngle(shoulderMid, hipMid)).toBe(45);
    });
  });

  describe('ExponentialFilter', () => {
    it('initializes with the first value and smooths subsequent values', () => {
      const filter = new ExponentialFilter(0.5);
      expect(filter.filter(100)).toBe(100);
      expect(filter.filter(120)).toBe(110);
      expect(filter.filter(120)).toBe(115);
    });

    it('clears state when reset() is called', () => {
      const filter = new ExponentialFilter(0.4);
      filter.filter(100);
      filter.filter(150);
      filter.reset();
      expect(filter.filter(80)).toBe(80);
    });
  });

  describe('KinematicsEngine', () => {
    it('returns null for empty or incomplete landmark arrays', () => {
      const engine = new KinematicsEngine();
      expect(engine.extractMetrics([], 'IDLE', 0, 0)).toBeNull();
      expect(engine.extractMetrics([{ x: 0, y: 0 }], 'IDLE', 0, 0)).toBeNull();
    });

    it('returns null when both knees have low visibility (<= 0.4)', () => {
      const engine = new KinematicsEngine();
      const landmarks = createBaseLandmarks();
      landmarks[POSE_LANDMARKS.LEFT_KNEE].visibility = 0.2;
      landmarks[POSE_LANDMARKS.RIGHT_KNEE].visibility = 0.3;

      expect(engine.extractMetrics(landmarks, 'IDLE', 0, 0)).toBeNull();
    });

    it('extracts accurate metrics for a standing nominal posture', () => {
      const engine = new KinematicsEngine();
      const landmarks = createBaseLandmarks();

      const metrics = engine.extractMetrics(landmarks, 'IDLE', 250, 2);
      expect(metrics).not.toBeNull();
      expect(metrics!.kneeAngle).toBe(180);
      expect(metrics!.leftKneeAngle).toBe(180);
      expect(metrics!.rightKneeAngle).toBe(180);
      expect(metrics!.hipAngle).toBe(180);
      expect(metrics!.torsoAngle).toBe(0);
      expect(metrics!.kneeDistanceRatio).toBe(1);
      expect(metrics!.phase).toBe('IDLE');
      expect(metrics!.repCount).toBe(2);
    });

    it('detects reduced kneeDistanceRatio during knee valgus collapse', () => {
      const engine = new KinematicsEngine();
      const landmarks = createBaseLandmarks();
      // Collapse knees inward (distance 0.08 vs hip/ankle distance 0.20 => ratio 0.4)
      landmarks[POSE_LANDMARKS.LEFT_KNEE] = { x: 0.46, y: 0.7, visibility: 0.95 };
      landmarks[POSE_LANDMARKS.RIGHT_KNEE] = { x: 0.54, y: 0.7, visibility: 0.95 };

      const metrics = engine.extractMetrics(landmarks, 'DESCENT', 1000, 1);
      expect(metrics).not.toBeNull();
      expect(metrics!.kneeDistanceRatio).toBe(0.4);
    });

    it('resets internal smoothing filters when reset() is called', () => {
      const engine = new KinematicsEngine();
      const landmarks = createBaseLandmarks();
      engine.extractMetrics(landmarks, 'IDLE', 0, 0);

      // Change knee angle to 90 degrees
      landmarks[POSE_LANDMARKS.LEFT_HIP] = { x: 0.4, y: 0.7, visibility: 0.95 };
      landmarks[POSE_LANDMARKS.RIGHT_HIP] = { x: 0.6, y: 0.7, visibility: 0.95 };
      landmarks[POSE_LANDMARKS.LEFT_KNEE] = { x: 0.2, y: 0.7, visibility: 0.95 };
      landmarks[POSE_LANDMARKS.RIGHT_KNEE] = { x: 0.8, y: 0.7, visibility: 0.95 };
      landmarks[POSE_LANDMARKS.LEFT_ANKLE] = { x: 0.2, y: 0.9, visibility: 0.95 };
      landmarks[POSE_LANDMARKS.RIGHT_ANKLE] = { x: 0.8, y: 0.9, visibility: 0.95 };

      engine.reset();
      const metricsAfterReset = engine.extractMetrics(landmarks, 'BOTTOM', 0, 0);
      expect(metricsAfterReset!.kneeAngle).toBe(90);
    });
  });
});
