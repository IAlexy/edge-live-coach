// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { LiveCoachApp } from '../../src/main';
import { VisualRenderer } from '../../src/visuals';
import { AnomalyEvent } from '../../src/types';

const indexHtml = fs.readFileSync(
  path.resolve(process.cwd(), 'index.html'),
  'utf-8'
);

function createMockCanvasContext(): CanvasRenderingContext2D {
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    strokeText: vi.fn(),
    fillText: vi.fn(),
    lineCap: 'round',
    lineJoin: 'round',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: ''
  } as unknown as CanvasRenderingContext2D;
}

describe('User Interface & HUD Components (UI Tests)', () => {
  let app: LiveCoachApp;
  let mockCtx: CanvasRenderingContext2D;

  beforeEach(() => {
    document.documentElement.innerHTML = indexHtml;
    mockCtx = createMockCanvasContext();
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCtx) as any;

    app = new LiveCoachApp({
      autoConnectWs: false,
      initMediaPipe: false,
      startLoop: false
    });
  });

  afterEach(() => {
    app.destroy();
    vi.restoreAllMocks();
  });

  it('renders initial Zero-Media privacy badge, HUD elements, and default 100% scores', () => {
    const badge = document.querySelector('.privacy-badge');
    expect(badge?.textContent).toContain('ZÉRO VIDÉO / AUDIO ENREGISTRÉS');

    expect(document.getElementById('rep-count')?.textContent).toBe('0');
    expect(document.getElementById('phase-pill')?.textContent).toBe('PRÊT');
    expect(document.getElementById('score-global')?.textContent).toBe('100%');
    expect(document.getElementById('mode-status')?.textContent).toBe('Mode Simulateur Actif');
  });

  it('switches biomechanical anomaly scenarios via UI buttons and resets detector', () => {
    const btnValgus = document.getElementById('btn-sim-valgus') as HTMLButtonElement;
    const btnNominal = document.getElementById('btn-sim-nominal') as HTMLButtonElement;
    const btnFast = document.getElementById('btn-sim-fast') as HTMLButtonElement;
    const btnDepth = document.getElementById('btn-sim-depth') as HTMLButtonElement;
    const btnTorso = document.getElementById('btn-sim-torso') as HTMLButtonElement;

    expect(btnNominal.classList.contains('active')).toBe(true);

    btnValgus.click();
    expect(app.simulator.scenario).toBe('KNEE_VALGUS');
    expect(btnValgus.classList.contains('active')).toBe(true);
    expect(btnNominal.classList.contains('active')).toBe(false);

    btnFast.click();
    expect(app.simulator.scenario).toBe('TEMPO_TOO_FAST');
    expect(btnFast.classList.contains('active')).toBe(true);

    btnDepth.click();
    expect(app.simulator.scenario).toBe('INSUFFICIENT_DEPTH');
    expect(btnDepth.classList.contains('active')).toBe(true);

    btnTorso.click();
    expect(app.simulator.scenario).toBe('EXCESSIVE_TORSO_LEAN');
    expect(btnTorso.classList.contains('active')).toBe(true);
  });

  it('updates real-time kinematic telemetry and draws skeleton when stepping frames', () => {
    app.stepFrame(0.2);

    const kneeVal = document.getElementById('metric-knee-angle')?.textContent;
    const torsoVal = document.getElementById('metric-torso-angle')?.textContent;
    const valgusVal = document.getElementById('metric-valgus-ratio')?.textContent;

    expect(kneeVal).toMatch(/^\d+(\.\d+)?°$/);
    expect(torsoVal).toMatch(/^\d+(\.\d+)?°$/);
    expect(Number(valgusVal)).toBeGreaterThan(0);
    expect(mockCtx.stroke).toHaveBeenCalled();
    expect(mockCtx.arc).toHaveBeenCalled();
  });

  it('updates multi-factor progression bars and applies dynamic severity colors', () => {
    app.updateScoresUI({
      global: 74,
      stability: 90, // >= 80 -> green (#10B981)
      tempo: 68, // >= 60 -> amber (#F59E0B)
      depth: 45, // < 60 -> red (#EF4444)
      posture: 85
    });

    expect(document.getElementById('score-global')?.textContent).toBe('74%');
    expect(document.getElementById('score-stability')?.textContent).toBe('90%');
    expect(document.getElementById('score-tempo')?.textContent).toBe('68%');
    expect(document.getElementById('score-depth')?.textContent).toBe('45%');

    const barStability = document.getElementById('bar-stability') as HTMLElement;
    const barTempo = document.getElementById('bar-tempo') as HTMLElement;
    const barDepth = document.getElementById('bar-depth') as HTMLElement;

    expect(barStability.style.width).toBe('90%');
    expect(barTempo.style.width).toBe('68%');
    expect(barDepth.style.width).toBe('45%');
  });

  it('displays accessible HUD Toast, updates Cloud Inspector, and logs to Audit Table on anomaly', async () => {
    const anomaly: AnomalyEvent = {
      eventId: 'evt_ui_1',
      timestamp: Date.now(),
      exercise: 'squat',
      repNumber: 2,
      phase: 'DESCENT',
      type: 'KNEE_VALGUS',
      severity: 'CRITICAL',
      metrics: {
        kneeAngle: 96,
        torsoAngle: 20,
        kneeDistanceRatio: 0.58,
        phaseDurationSec: 1.5
      },
      explanation: 'Valgus critique détecté'
    };

    await app.handleAnomaly(anomaly);

    const toast = document.getElementById('coach-toast') as HTMLElement;
    const toastText = document.getElementById('toast-text') as HTMLElement;
    expect(toast.classList.contains('hidden')).toBe(false);
    expect(toast.classList.contains('toast-valgus')).toBe(true);
    expect(toastText.textContent).toContain('Écarte les genoux');

    const promptBox = document.getElementById('last-prompt-display') as HTMLElement;
    const responseBox = document.getElementById('last-response-display') as HTMLElement;
    expect(promptBox.textContent).toContain('KNEE_VALGUS');
    expect(responseBox.textContent).toContain('Écarte les genoux');

    const auditBody = document.getElementById('audit-table-body') as HTMLElement;
    expect(auditBody.querySelectorAll('tr.log-row')).toHaveLength(1);
    expect(auditBody.textContent).toContain('Rep #2');

    // Clear logs via UI button
    const btnClear = document.getElementById('btn-clear-logs') as HTMLButtonElement;
    btnClear.click();
    expect(auditBody.querySelectorAll('tr.log-row')).toHaveLength(0);
    expect(auditBody.textContent).toContain('Aucun incident pour le moment');
  });

  it('toggles accessibility checkboxes (Audio Earcons & TTS)', () => {
    const audioSpy = vi.spyOn(app.accessibility, 'setAudioEnabled');
    const ttsSpy = vi.spyOn(app.accessibility, 'setTtsEnabled');

    const toggleAudio = document.getElementById('toggle-audio') as HTMLInputElement;
    const toggleTts = document.getElementById('toggle-tts') as HTMLInputElement;

    toggleAudio.checked = false;
    toggleAudio.dispatchEvent(new Event('change'));
    expect(audioSpy).toHaveBeenCalledWith(false);

    toggleTts.checked = false;
    toggleTts.dispatchEvent(new Event('change'));
    expect(ttsSpy).toHaveBeenCalledWith(false);
  });

  it('renders VisualRenderer outward corrective arrows during KNEE_VALGUS highlight', () => {
    const canvas = document.getElementById('pose-canvas') as HTMLCanvasElement;
    const renderer = new VisualRenderer(canvas);
    const landmarks = app.simulator.generateFrame(0.5);
    const metrics = app.kinematics.extractMetrics(landmarks, 'BOTTOM', 1500, 1);

    renderer.setAnomalyHighlight(
      {
        eventId: 'evt_vis_1',
        timestamp: Date.now(),
        exercise: 'squat',
        repNumber: 1,
        phase: 'BOTTOM',
        type: 'KNEE_VALGUS',
        severity: 'HIGH',
        metrics: {
          kneeAngle: 90,
          torsoAngle: 15,
          kneeDistanceRatio: 0.6,
          phaseDurationSec: 1.5
        },
        explanation: 'Valgus'
      },
      5000
    );

    renderer.render(null, landmarks, metrics);
    expect(mockCtx.strokeRect).toHaveBeenCalled();
    expect(mockCtx.fillText).toHaveBeenCalled();
  });
});
