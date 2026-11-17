/**
 * Synthesized sound effects (no audio files to ship or license).
 * Bubble plop on each ingredient, a simmer that rises as Brimstone nears the limit,
 * a fizzing fuse plus explosion on KABOOM, coin clinks when you cork it.
 * (Method names are kept from the engine's internal vocabulary.)
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private fanOsc: OscillatorNode | null = null;
  private fanGain: GainNode | null = null;
  muted = false;

  /** Must be called from a user gesture (browser autoplay rules). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    }
    void this.ctx.resume();
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running' && !this.muted;
  }

  private noise(duration: number): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  private env(gain: number, attack: number, decay: number, at = 0): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const t = ctx.currentTime + at;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(ctx.destination);
    return g;
  }

  /** Bubble plop: a sine blip whose pitch jumps up, like a bubble popping. */
  clack() {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f = 180 + Math.random() * 120;
    o.frequency.setValueAtTime(f, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(f * 3.2, ctx.currentTime + 0.07);
    o.connect(this.env(0.35, 0.004, 0.09));
    o.start();
    o.stop(ctx.currentTime + 0.12);
  }

  bug() {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(220, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.15);
    o.connect(this.env(0.12, 0.005, 0.18));
    o.start();
    o.stop(ctx.currentTime + 0.25);
  }

  chaChing() {
    if (!this.ready) return;
    const ctx = this.ctx!;
    [1318.5, 1760].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.connect(this.env(0.25, 0.005, 0.35, i * 0.09));
      o.start(ctx.currentTime + i * 0.09);
      o.stop(ctx.currentTime + i * 0.09 + 0.5);
    });
    const src = this.noise(0.12);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000;
    src.connect(hp).connect(this.env(0.15, 0.002, 0.1));
    src.start();
  }

  /** Fizzing fuse before the boom: crackly high-passed noise that swells. */
  pager() {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const src = this.noise(0.8);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(3000, ctx.currentTime);
    hp.frequency.linearRampToValueAtTime(7000, ctx.currentTime + 0.75);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.02, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.7);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
    src.connect(hp).connect(g).connect(ctx.destination);
    src.start();
  }

  explosion() {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const src = this.noise(1.4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1200, ctx.currentTime + 0.8);
    lp.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 2.0);
    src.connect(lp).connect(this.env(0.9, 0.01, 1.2, 0.8));
    src.start(ctx.currentTime + 0.8);
  }

  stamp() {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const src = this.noise(0.2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    src.connect(lp).connect(this.env(0.9, 0.003, 0.18));
    src.start();
  }

  /** Cauldron simmer that rises in pitch as the worst Brimstone total nears the limit. level 0..1, null = off. */
  fan(level: number | null) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (level === null || this.muted) {
      this.fanGain?.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
      return;
    }
    if (!this.fanOsc) {
      this.fanOsc = ctx.createOscillator();
      this.fanOsc.type = 'sawtooth';
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      this.fanGain = ctx.createGain();
      this.fanGain.gain.value = 0;
      this.fanOsc.connect(lp).connect(this.fanGain).connect(ctx.destination);
      this.fanOsc.start();
    }
    const l = Math.max(0, Math.min(1, level));
    this.fanOsc.frequency.setTargetAtTime(90 + l * l * 700, ctx.currentTime, 0.4);
    this.fanGain!.gain.setTargetAtTime(l < 0.3 ? 0 : 0.015 + l * 0.035, ctx.currentTime, 0.4);
  }
}
