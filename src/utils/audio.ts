/**
 * Lightweight procedural football-game audio using Web Audio.
 * Uses a master compressor so layered SFX stay clean on mobile speakers.
 */
class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  public enabled = true;

  private getContext(): AudioContext | null {
    if (!this.enabled || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -20;
      compressor.knee.value = 18;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.16;
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.72;
      this.master.connect(compressor);
      compressor.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  private tone(
    frequency: number,
    duration: number,
    type: OscillatorType = 'sine',
    volume = 0.08,
    endFrequency?: number,
    startDelay = 0
  ) {
    const ctx = this.getContext();
    if (!ctx || !this.master) return;
    const start = ctx.currentTime + startDelay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    if (endFrequency) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.015, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  private noise(duration: number, volume = 0.025, startDelay = 0) {
    const ctx = this.getContext();
    if (!ctx || !this.master) return;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const start = ctx.currentTime + startDelay;
    filter.type = 'bandpass';
    filter.frequency.value = 1800;
    filter.Q.value = 0.7;
    gain.gain.value = volume;
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(start);
  }

  playWhistle() {
    this.tone(2350, 0.22, 'triangle', 0.13, 1850);
    this.tone(3100, 0.16, 'triangle', 0.08, 2500, 0.03);
  }

  playBid() {
    this.tone(740, 0.08, 'sine', 0.07, 980);
    this.tone(1110, 0.12, 'sine', 0.055, 1320, 0.05);
  }

  playGavel() {
    this.tone(150, 0.13, 'square', 0.14, 62);
    this.noise(0.09, 0.045);
    this.tone(92, 0.16, 'triangle', 0.08, 55, 0.07);
  }

  playGoal() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      this.tone(f, 0.52, 'triangle', 0.095, f * 1.01, i * 0.075);
    });
    this.tone(156.8, 0.48, 'sine', 0.07, 110, 0.02);
    this.noise(0.28, 0.025, 0.05);
  }

  playTick() {
    this.tone(1500, 0.035, 'sine', 0.045, 1150);
  }

  playClick() {
    this.tone(620, 0.045, 'sine', 0.055, 340);
  }

  playCard() {
    this.tone(420, 0.14, 'sawtooth', 0.055, 220);
    this.tone(260, 0.11, 'square', 0.035, 150, 0.05);
  }

  playPass() {
    this.tone(560, 0.045, 'sine', 0.025, 700);
  }

  playTackle() {
    this.noise(0.06, 0.035);
    this.tone(180, 0.08, 'triangle', 0.035, 110);
  }

  playShot() {
    this.tone(820, 0.07, 'sine', 0.045, 980);
    this.noise(0.05, 0.02);
  }

  playMatchStart() {
    this.playWhistle();
  }
}

export const sound = new SoundEngine();