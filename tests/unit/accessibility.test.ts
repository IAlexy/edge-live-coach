// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AccessibilityManager } from '../../src/accessibility';

describe('AccessibilityManager (Unit Tests)', () => {
  let startMock: ReturnType<typeof vi.fn>;
  let stopMock: ReturnType<typeof vi.fn>;
  let speakMock: ReturnType<typeof vi.fn>;
  let cancelMock: ReturnType<typeof vi.fn>;
  let vibrateMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    startMock = vi.fn();
    stopMock = vi.fn();
    speakMock = vi.fn();
    cancelMock = vi.fn();
    vibrateMock = vi.fn();

    class MockAudioContext {
      state = 'running';
      currentTime = 0;
      destination = {};
      resume = vi.fn();
      createOscillator() {
        return {
          type: 'sine',
          frequency: {
            setValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn()
          },
          connect: vi.fn(),
          start: startMock,
          stop: stopMock
        };
      }
      createGain() {
        return {
          gain: {
            setValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn()
          },
          connect: vi.fn()
        };
      }
      createBiquadFilter() {
        return {
          type: 'lowpass',
          frequency: { setValueAtTime: vi.fn() },
          connect: vi.fn()
        };
      }
    }

    (window as any).AudioContext = MockAudioContext;

    class MockUtterance {
      text: string;
      lang = '';
      voice = null;
      rate = 1;
      pitch = 1;
      volume = 1;
      constructor(text: string) {
        this.text = text;
      }
    }
    (window as any).SpeechSynthesisUtterance = MockUtterance;
    Object.defineProperty(window, 'speechSynthesis', {
      writable: true,
      value: {
        getVoices: () => [{ lang: 'fr-FR', name: 'French Voice' }],
        speak: speakMock,
        cancel: cancelMock,
        onvoiceschanged: null
      }
    });

    Object.defineProperty(navigator, 'vibrate', {
      writable: true,
      value: vibrateMock
    });
  });

  it('plays phase earcons for DESCENT, BOTTOM, ASCENT, and COMPLETED when audio is enabled', () => {
    const manager = new AccessibilityManager();

    manager.playPhaseEarcon('DESCENT');
    manager.playPhaseEarcon('BOTTOM');
    manager.playPhaseEarcon('ASCENT');
    manager.playPhaseEarcon('COMPLETED');

    expect(startMock).toHaveBeenCalledTimes(4);
    expect(stopMock).toHaveBeenCalledTimes(4);

    // Disable audio -> no new oscillator calls
    manager.setAudioEnabled(false);
    manager.playPhaseEarcon('DESCENT');
    expect(startMock).toHaveBeenCalledTimes(4);
  });

  it('plays alert sound and triggers haptic vibration on anomaly', () => {
    const manager = new AccessibilityManager();
    manager.playAlertSound();

    expect(startMock).toHaveBeenCalledTimes(1);
    expect(vibrateMock).toHaveBeenCalledWith([100, 50, 100]);
  });

  it('speaks coaching cues via Web Speech API and respects TTS toggle', () => {
    const manager = new AccessibilityManager();
    manager.speakCue('Pousse le sol et écarte les genoux !');

    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(speakMock.mock.calls[0][0].text).toBe('Pousse le sol et écarte les genoux !');
    expect(speakMock.mock.calls[0][0].lang).toBe('fr-FR');

    manager.setTtsEnabled(false);
    manager.speakCue('Autre consigne');
    expect(speakMock).toHaveBeenCalledTimes(1);
  });
});
