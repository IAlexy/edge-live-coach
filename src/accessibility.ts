import { SquatPhase } from './types';

/**
 * Gestionnaire d'accessibilité universelle :
 * - Canal Audio (Earcons rythmiques + Synthèse vocale TTS) pour les personnes malvoyantes
 * - Retours haptiques (vibration)
 */
export class AccessibilityManager {
  private audioCtx: AudioContext | null = null;
  private isAudioEnabled = true;
  private isTtsEnabled = true;
  private frenchVoice: SpeechSynthesisVoice | null = null;

  constructor() {
    this.initVoices();
  }

  private initVoices(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const loadVoice = () => {
        const voices = window.speechSynthesis.getVoices();
        this.frenchVoice = voices.find(v => v.lang.startsWith('fr')) || null;
      };
      loadVoice();
      window.speechSynthesis.onvoiceschanged = loadVoice;
    }
  }

  private getAudioContext(): AudioContext | null {
    if (!this.audioCtx && typeof window !== 'undefined') {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) {
        this.audioCtx = new AudioCtxClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  setAudioEnabled(enabled: boolean): void {
    this.isAudioEnabled = enabled;
  }

  setTtsEnabled(enabled: boolean): void {
    this.isTtsEnabled = enabled;
  }

  /**
   * Joue un son rythmique (Earcon) adapté à la phase en cours du mouvement.
   */
  playPhaseEarcon(phase: SquatPhase): void {
    if (!this.isAudioEnabled) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    switch (phase) {
      case 'DESCENT':
        // Ton descendant doux pour indiquer le tempo d'excentrique
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(320, now + 0.3);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.35);
        break;

      case 'BOTTOM':
        // Chime distinctif : profondeur atteinte
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(587.33, now); // Ré5
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
        break;

      case 'ASCENT':
        // Ton montant pour accompagner l'effort concentrique
        osc.type = 'sine';
        osc.frequency.setValueAtTime(350, now);
        osc.frequency.exponentialRampToValueAtTime(520, now + 0.25);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.28);
        break;

      case 'COMPLETED':
        // Bip de validation de répétition
        osc.type = 'sine';
        osc.frequency.setValueAtTime(659.25, now); // Mi5
        osc.frequency.setValueAtTime(880, now + 0.1); // La5
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
        break;
    }
  }

  /**
   * Joue un son d'alerte court et immédiatement identifiable.
   */
  playAlertSound(): void {
    if (!this.isAudioEnabled) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.setValueAtTime(240, now + 0.1);

    // Filtre passe-bas pour ne pas être agressif
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, now);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.start(now);
    osc.stop(now + 0.3);

    // Retour haptique si supporté
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([100, 50, 100]);
    }
  }

  /**
   * Prononce vocalement le conseil concis du coach (Web Speech API).
   */
  speakCue(cueText: string): void {
    if (!this.isTtsEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    // Annule toute parole précédente pour être immédiat et réactif
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(cueText);
    utterance.lang = 'fr-FR';
    if (this.frenchVoice) {
      utterance.voice = this.frenchVoice;
    }
    utterance.rate = 1.15; // Débit légèrement dynamique pour coller au rythme sportif
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    window.speechSynthesis.speak(utterance);
  }
}
