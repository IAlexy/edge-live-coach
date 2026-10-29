import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { KinematicsEngine } from './kinematics';
import { SquatDetector } from './detector';
import { VisualRenderer } from './visuals';
import { AccessibilityManager } from './accessibility';
import { Agent2Bridge } from './agent2_bridge';
import { GestureSimulator, SimulationScenario } from './simulator';
import { Point3D, AnomalyEvent, CloudAuditEntry, RepScores } from './types';

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export interface LiveCoachOptions {
  autoConnectWs?: boolean;
  initMediaPipe?: boolean;
  startLoop?: boolean;
}

export class LiveCoachApp {
  public readonly kinematics = new KinematicsEngine();
  public readonly accessibility = new AccessibilityManager();
  public readonly simulator = new GestureSimulator();
  public readonly detector: SquatDetector;
  public readonly renderer: VisualRenderer;
  public readonly agent2Bridge: Agent2Bridge;

  // Éléments du DOM
  private video = document.getElementById('webcam-video') as HTMLVideoElement;
  private canvas = document.getElementById('pose-canvas') as HTMLCanvasElement;
  private toastBanner = document.getElementById('coach-toast') as HTMLElement;
  private toastText = document.getElementById('toast-text') as HTMLElement;
  private repCounterEl = document.getElementById('rep-count') as HTMLElement;
  private phasePillEl = document.getElementById('phase-pill') as HTMLElement;
  private tempoBarFill = document.getElementById('tempo-bar-fill') as HTMLElement;
  private kneeAngleEl = document.getElementById('metric-knee-angle') as HTMLElement;
  private torsoAngleEl = document.getElementById('metric-torso-angle') as HTMLElement;
  private valgusRatioEl = document.getElementById('metric-valgus-ratio') as HTMLElement;
  private lastPromptEl = document.getElementById('last-prompt-display') as HTMLElement;
  private lastResponseEl = document.getElementById('last-response-display') as HTMLElement;
  private auditTableBody = document.getElementById('audit-table-body') as HTMLElement;
  private modeStatusEl = document.getElementById('mode-status') as HTMLElement;
  private cloudStatusDot = document.getElementById('cloud-status-dot') as HTMLElement;
  private cloudStatusText = document.getElementById('cloud-status-text') as HTMLElement;

  // Éléments du tableau de bord de progression (Multi-facteurs)
  private scoreGlobalEl = document.getElementById('score-global') as HTMLElement;
  private scoreStabilityEl = document.getElementById('score-stability') as HTMLElement;
  private scoreTempoEl = document.getElementById('score-tempo') as HTMLElement;
  private scoreDepthEl = document.getElementById('score-depth') as HTMLElement;
  private scorePostureEl = document.getElementById('score-posture') as HTMLElement;
  private barStability = document.getElementById('bar-stability') as HTMLElement;
  private barTempo = document.getElementById('bar-tempo') as HTMLElement;
  private barDepth = document.getElementById('bar-depth') as HTMLElement;
  private barPosture = document.getElementById('bar-posture') as HTMLElement;
  private debriefBox = document.getElementById('debrief-box') as HTMLElement;
  private btnEndSession = document.getElementById('btn-end-session') as HTMLButtonElement;

  // Boutons de contrôle
  private btnWebcam = document.getElementById('btn-webcam') as HTMLButtonElement;
  private btnSimNominal = document.getElementById('btn-sim-nominal') as HTMLButtonElement;
  private btnSimValgus = document.getElementById('btn-sim-valgus') as HTMLButtonElement;
  private btnSimFast = document.getElementById('btn-sim-fast') as HTMLButtonElement;
  private btnSimDepth = document.getElementById('btn-sim-depth') as HTMLButtonElement;
  private btnSimTorso = document.getElementById('btn-sim-torso') as HTMLButtonElement;
  private toggleAudio = document.getElementById('toggle-audio') as HTMLInputElement;
  private toggleTts = document.getElementById('toggle-tts') as HTMLInputElement;

  private poseLandmarker: PoseLandmarker | null = null;
  private isWebcamActive = false;
  private lastVideoTime = -1;
  private animationFrameId: number | null = null;
  private lastTimestamp = performance.now();
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(options: LiveCoachOptions = {}) {
    const { autoConnectWs = true, initMediaPipe = true, startLoop = true } = options;

    this.canvas.width = 640;
    this.canvas.height = 480;
    this.renderer = new VisualRenderer(this.canvas);

    this.agent2Bridge = new Agent2Bridge(
      {
        onLogUpdated: (logs: CloudAuditEntry[]) => {
          this.renderAuditLogs(logs);
        },
        onCoachingCueReceived: (feedback) => {
          this.lastResponseEl.textContent = feedback.visualCue;
          this.showToast(feedback.visualCue, feedback.actionZone);
          this.accessibility.speakCue(feedback.audioCue);
        },
        onConnectionStatusChanged: (connected) => {
          if (connected) {
            this.cloudStatusDot.className = 'dot green';
            this.cloudStatusText.textContent = 'Agent 2 (Cloud) : Connecté WebSocket';
          } else {
            this.cloudStatusDot.className = 'dot blue';
            this.cloudStatusText.textContent = 'Agent 2 (Cloud) : Mode Réflexe Local';
          }
        },
        onDebriefReceived: (debriefText) => {
          this.debriefBox.textContent = debriefText;
          this.debriefBox.classList.remove('hidden');
          this.accessibility.speakCue('Voici le bilan de progression de ta série.');
        }
      },
      autoConnectWs
    );

    this.detector = new SquatDetector({
      onPhaseChange: (newPhase) => {
        this.updatePhaseUI(newPhase);
        this.accessibility.playPhaseEarcon(newPhase);
      },
      onAnomalyDetected: async (anomaly: AnomalyEvent) => {
        await this.handleAnomaly(anomaly);
      },
      onRepCompleted: (repCount, durationSec, scores: RepScores) => {
        this.repCounterEl.textContent = repCount.toString();
        this.accessibility.playPhaseEarcon('COMPLETED');
        this.showToast(
          `Répétition #${repCount} validée (${durationSec}s) — Score : ${scores.global}%`,
          'NOMINAL'
        );

        this.updateScoresUI(scores);
        this.agent2Bridge.sendRepScores(repCount, scores, durationSec);
      }
    });

    this.bindEvents();
    this.simulator.start();
    this.setSimulatorScenario('NOMINAL');

    if (startLoop) {
      this.animationFrameId = requestAnimationFrame(() => this.gameLoop());
    }

    if (initMediaPipe) {
      void this.initMediaPipeEngine();
    }
  }

  private bindEvents(): void {
    this.btnWebcam?.addEventListener('click', () => {
      void this.toggleWebcam();
    });
    this.btnSimNominal?.addEventListener('click', () => this.setSimulatorScenario('NOMINAL'));
    this.btnSimValgus?.addEventListener('click', () => this.setSimulatorScenario('KNEE_VALGUS'));
    this.btnSimFast?.addEventListener('click', () => this.setSimulatorScenario('TEMPO_TOO_FAST'));
    this.btnSimDepth?.addEventListener('click', () =>
      this.setSimulatorScenario('INSUFFICIENT_DEPTH')
    );
    this.btnSimTorso?.addEventListener('click', () =>
      this.setSimulatorScenario('EXCESSIVE_TORSO_LEAN')
    );

    this.toggleAudio?.addEventListener('change', (e) => {
      this.accessibility.setAudioEnabled((e.target as HTMLInputElement).checked);
    });

    this.toggleTts?.addEventListener('change', (e) => {
      this.accessibility.setTtsEnabled((e.target as HTMLInputElement).checked);
    });

    this.btnEndSession?.addEventListener('click', () => {
      this.agent2Bridge.requestSessionDebrief();
    });

    document.getElementById('btn-clear-logs')?.addEventListener('click', () => {
      this.agent2Bridge.clearLogs();
    });
  }

  async initMediaPipeEngine(): Promise<void> {
    try {
      const vision = await FilesetResolver.forVisionTasks('/wasm');
      this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/models/pose_landmarker_lite.task',
          delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        numPoses: 1
      });
    } catch {
      try {
        const vision = await FilesetResolver.forVisionTasks('/wasm');
        this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/models/pose_landmarker_lite.task',
            delegate: 'CPU'
          },
          runningMode: 'VIDEO',
          numPoses: 1
        });
      } catch (e) {
        console.error('Échec initialisation MediaPipe:', e);
      }
    }
  }

  async handleAnomaly(anomaly: AnomalyEvent): Promise<void> {
    this.renderer.setAnomalyHighlight(anomaly);
    this.accessibility.playAlertSound();

    const feedback = await this.agent2Bridge.processAnomaly(anomaly);

    this.lastPromptEl.textContent = this.agent2Bridge.generateCloudPrompt(anomaly);
    this.lastResponseEl.textContent = feedback.visualCue;

    this.showToast(feedback.visualCue, anomaly.type);
    this.accessibility.speakCue(feedback.audioCue);
  }

  updateScoresUI(scores: RepScores): void {
    this.scoreGlobalEl.textContent = `${scores.global}%`;
    this.scoreStabilityEl.textContent = `${scores.stability}%`;
    this.scoreTempoEl.textContent = `${scores.tempo}%`;
    this.scoreDepthEl.textContent = `${scores.depth}%`;
    this.scorePostureEl.textContent = `${scores.posture}%`;

    this.barStability.style.width = `${scores.stability}%`;
    this.barTempo.style.width = `${scores.tempo}%`;
    this.barDepth.style.width = `${scores.depth}%`;
    this.barPosture.style.width = `${scores.posture}%`;

    const getColor = (s: number) => (s >= 80 ? '#10B981' : s >= 60 ? '#F59E0B' : '#EF4444');
    this.barStability.style.backgroundColor = getColor(scores.stability);
    this.barTempo.style.backgroundColor = getColor(scores.tempo);
    this.barDepth.style.backgroundColor = getColor(scores.depth);
    this.barPosture.style.backgroundColor = getColor(scores.posture);
  }

  showToast(text: string, type: string): void {
    this.toastText.textContent = text;
    this.toastBanner.classList.remove(
      'hidden',
      'toast-valgus',
      'toast-fast',
      'toast-depth',
      'toast-torso',
      'toast-nominal'
    );

    if (type === 'KNEE_VALGUS' || type === 'KNEES') this.toastBanner.classList.add('toast-valgus');
    else if (type === 'TEMPO_TOO_FAST' || type === 'TEMPO')
      this.toastBanner.classList.add('toast-fast');
    else if (type === 'INSUFFICIENT_DEPTH' || type === 'DEPTH')
      this.toastBanner.classList.add('toast-depth');
    else if (type === 'EXCESSIVE_TORSO_LEAN' || type === 'TORSO')
      this.toastBanner.classList.add('toast-torso');
    else this.toastBanner.classList.add('toast-nominal');

    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toastBanner.classList.add('hidden');
    }, 3500);
  }

  updatePhaseUI(phase: string): void {
    const phaseTranslations: Record<string, { label: string; color: string }> = {
      IDLE: { label: 'PRÊT', color: '#6B7280' },
      DESCENT: { label: 'DESCENTE (3s)', color: '#3B82F6' },
      BOTTOM: { label: 'POINT BAS', color: '#8B5CF6' },
      ASCENT: { label: 'REMONTÉE (1s)', color: '#10B981' },
      COMPLETED: { label: 'VALIDÉ', color: '#059669' }
    };

    const current = phaseTranslations[phase] || { label: phase, color: '#6B7280' };
    this.phasePillEl.textContent = current.label;
    this.phasePillEl.style.backgroundColor = current.color;
  }

  renderAuditLogs(logs: CloudAuditEntry[]): void {
    if (logs.length === 0) {
      this.auditTableBody.innerHTML = `<tr><td colspan="5" class="empty-log">Aucun incident pour le moment (Mouvement nominal).</td></tr>`;
      return;
    }

    this.auditTableBody.innerHTML = logs
      .map(
        (log) => `
    <tr class="log-row">
      <td class="log-time">${escapeHtml(log.timestamp)}</td>
      <td><span class="anomaly-badge ${escapeHtml(String(log.anomalyType))}">${escapeHtml(String(log.anomalyType))}</span></td>
      <td class="log-rep">${log.repNumber > 0 ? 'Rep #' + log.repNumber : '-'}</td>
      <td class="log-response font-bold text-emerald-400">"${escapeHtml(log.coachResponse)}"</td>
      <td class="log-latency text-xs text-gray-400">${log.latencyMs} ms</td>
    </tr>
  `
      )
      .join('');
  }

  stepFrame(deltaSec: number): void {
    let currentLandmarks: Point3D[] | null = null;

    if (this.isWebcamActive && this.video.readyState >= 2 && this.poseLandmarker) {
      if (this.video.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = this.video.currentTime;
        const result = this.poseLandmarker.detectForVideo(this.video, performance.now());
        if (result.landmarks && result.landmarks.length > 0) {
          currentLandmarks = result.landmarks[0] as Point3D[];
        }
      }
    } else if (this.simulator.running) {
      currentLandmarks = this.simulator.generateFrame(deltaSec);
    }

    if (currentLandmarks) {
      const metrics = this.kinematics.extractMetrics(
        currentLandmarks,
        this.detector.currentPhase,
        this.detector.activePhaseDuration,
        this.detector.currentRepCount
      );

      if (metrics) {
        this.detector.update(metrics);

        this.kneeAngleEl.textContent = `${metrics.kneeAngle}°`;
        this.torsoAngleEl.textContent = `${metrics.torsoAngle}°`;
        this.valgusRatioEl.textContent = `${metrics.kneeDistanceRatio}`;
        this.valgusRatioEl.style.color = metrics.kneeDistanceRatio < 0.72 ? '#EF4444' : '#10B981';

        const phaseDuration = this.detector.activePhaseDuration / 1000;
        if (this.detector.currentPhase === 'DESCENT') {
          const progress = Math.min((phaseDuration / 3.0) * 100, 100);
          this.tempoBarFill.style.height = `${progress}%`;
          this.tempoBarFill.style.backgroundColor = progress < 40 ? '#EF4444' : '#3B82F6';
        } else if (this.detector.currentPhase === 'ASCENT') {
          const progress = Math.min((phaseDuration / 1.0) * 100, 100);
          this.tempoBarFill.style.height = `${100 - progress}%`;
          this.tempoBarFill.style.backgroundColor = '#10B981';
        } else {
          this.tempoBarFill.style.height = '100%';
          this.tempoBarFill.style.backgroundColor = '#6B7280';
        }

        this.renderer.render(this.isWebcamActive ? this.video : null, currentLandmarks, metrics);
      }
    } else {
      this.renderer.render(null, null, null);
    }
  }

  private gameLoop(): void {
    const now = performance.now();
    const deltaSec = (now - this.lastTimestamp) / 1000;
    this.lastTimestamp = now;

    this.stepFrame(deltaSec);
    this.animationFrameId = requestAnimationFrame(() => this.gameLoop());
  }

  async toggleWebcam(): Promise<void> {
    if (this.isWebcamActive) {
      const stream = this.video.srcObject as MediaStream | null;
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      this.video.srcObject = null;
      this.isWebcamActive = false;
      this.btnWebcam.textContent = 'Activer la Webcam (WebGPU)';
      this.btnWebcam.classList.remove('active');
      this.simulator.start();
      this.modeStatusEl.textContent = 'Mode Simulateur Actif';
      this.modeStatusEl.className = 'status-tag sim';
    } else {
      try {
        this.simulator.stop();
        this.modeStatusEl.textContent = 'Connexion à la caméra...';
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }
        });
        this.video.srcObject = stream;
        await this.video.play();
        this.isWebcamActive = true;
        this.btnWebcam.textContent = 'Désactiver la Webcam';
        this.btnWebcam.classList.add('active');
        this.modeStatusEl.textContent = 'Mode Webcam Direct (WebGPU)';
        this.modeStatusEl.className = 'status-tag live';
      } catch (err) {
        if (typeof window !== 'undefined' && typeof window.alert === 'function') {
          window.alert("Impossible d'accéder à la webcam : " + (err as Error).message);
        }
        this.simulator.start();
        this.modeStatusEl.textContent = 'Mode Simulateur Actif';
        this.modeStatusEl.className = 'status-tag sim';
      }
    }
  }

  setSimulatorScenario(scenario: SimulationScenario): void {
    if (this.isWebcamActive) {
      void this.toggleWebcam();
    }
    this.simulator.setScenario(scenario);
    this.kinematics.reset();
    this.detector.reset();

    [
      this.btnSimNominal,
      this.btnSimValgus,
      this.btnSimFast,
      this.btnSimDepth,
      this.btnSimTorso
    ].forEach((btn) => btn?.classList.remove('active'));
    if (scenario === 'NOMINAL') this.btnSimNominal?.classList.add('active');
    else if (scenario === 'KNEE_VALGUS') this.btnSimValgus?.classList.add('active');
    else if (scenario === 'TEMPO_TOO_FAST') this.btnSimFast?.classList.add('active');
    else if (scenario === 'INSUFFICIENT_DEPTH') this.btnSimDepth?.classList.add('active');
    else if (scenario === 'EXCESSIVE_TORSO_LEAN') this.btnSimTorso?.classList.add('active');
  }

  destroy(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }
    this.agent2Bridge.disconnect();
  }
}

if (typeof window !== 'undefined' && !(import.meta as any).env?.VITEST) {
  window.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('pose-canvas')) {
      new LiveCoachApp();
    }
  });
}
