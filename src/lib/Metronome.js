/**
 * Metronome — Web Audio API based metronome
 * Extracted from game.js
 */

export default class Metronome {
  constructor() {
    this.audioCtx = null;
    this.enabled  = false;
    this.bpm      = 100;
    this._next    = 0;
    this._count   = 0;
    this._timer   = null;
    /** Called on each beat: onBeat(isAccent) */
    this.onBeat   = null;
  }

  init(audioCtx) { this.audioCtx = audioCtx; }

  start(bpm) {
    if (!this.audioCtx) return;
    this.bpm    = bpm;
    this._next  = this.audioCtx.currentTime + 0.12;
    this._count = 0;
    this.enabled = true;
    this._tick();
  }

  stop() {
    this.enabled = false;
    clearTimeout(this._timer);
  }

  _tick() {
    if (!this.enabled) return;
    while (this._next < this.audioCtx.currentTime + 0.15) {
      this._click(this._next, this._count % 4 === 0);
      this._next += 60 / this.bpm;
      this._count++;
    }
    this._timer = setTimeout(() => this._tick(), 25);
  }

  _click(time, accent) {
    const osc  = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    osc.connect(gain);
    gain.connect(this.audioCtx.destination);
    osc.type = 'triangle';
    osc.frequency.value = accent ? 1100 : 760;
    gain.gain.setValueAtTime(accent ? 0.55 : 0.30, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.055);
    osc.start(time);
    osc.stop(time + 0.09);
    // Visual callback synchronized with audio
    const delay = Math.max(0, (time - this.audioCtx.currentTime) * 1000);
    setTimeout(() => this.onBeat?.(accent), delay);
  }
}
