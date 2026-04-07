/**
 * GameEngine — Sheet-music renderer + game loop
 */

import { noteNameToMidi } from "./PitchDetector.js";

// ── Note colors ───────────────────────────────────────────────
export const NOTE_COLORS = {
  C: "#ef4444",
  "C#": "#f97316",
  D: "#f59e0b",
  "D#": "#eab308",
  E: "#84cc16",
  F: "#22c55e",
  "F#": "#10b981",
  G: "#06b6d4",
  "G#": "#6366f1",
  A: "#8b5cf6",
  "A#": "#a855f7",
  B: "#ec4899",
};
export function noteColor(name) {
  return NOTE_COLORS[name.replace(/\d+$/, "")] ?? "#ffffff";
}

// ── Instrument transposition ─────────────────────────────────
export const SAX_TRANSPOSITIONS = { alto: 9, tenor: 2, soprano: 2 };
export const SAX_LABELS = {
  alto: "Alto (Mib)",
  tenor: "Tenor (Sib)",
  soprano: "Soprano (Sib)",
};
const _NOTES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];
export function midiToNoteName(midi) {
  return _NOTES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

// ── Diatonic step helpers (Treble Clef) ──────────────────────
// C4=0, D4=1, E4=2 … B4=6, C5=7 …  (ignores accidentals)
export const DIATONIC = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

export function diatonicStep(noteName) {
  const m = noteName.match(/^([A-G])(#|b?)(\d)$/);
  if (!m) return 0;
  return (parseInt(m[3]) - 4) * 7 + DIATONIC[m[1]];
}

// Top staff line = F5 (step 10).  Each diatonic step = ls/2 pixels.
export function staffNoteY(noteName, staffTopY, ls) {
  return staffTopY + (10 - diatonicStep(noteName)) * (ls / 2);
}

// ── Musical duration snapping ─────────────────────────────────
// Rounds a raw beat value to the nearest standard musical duration.
// Prevents floating-point drift (e.g. 0.499 → 0.5, 1.49 → 1.5) from
// breaking note-type classification, beam grouping, and rest calculation.
function snapToMusical(beats) {
  // Standard note durations in beats (quarter = 1 beat)
  const VALUES = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0];
  const TOLERANCE = 0.07; // ±70 ms at 60 BPM — tight enough to be safe, wide enough for real conversion noise
  let best = beats, bestDist = Infinity;
  for (const v of VALUES) {
    const d = Math.abs(beats - v);
    if (d < bestDist) { bestDist = d; best = v; }
  }
  return bestDist <= TOLERANCE ? best : beats;
}

// ── GameEngine ────────────────────────────────────────────────
export class GameEngine {
  constructor(canvas, detector, metronome, callbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.detector = detector;
    this.metronome = metronome;
    this.callbacks = callbacks ?? {};

    this.song = null;
    this.difficulty = "easy";
    this.speedMult = 1.0;
    this.saxType = "alto";

    this.startTime = 0;
    this.gameTime = 0;
    this.rafId = null;
    this.isPlaying = false;
    this.isPaused = false;

    this.notes = [];
    this.scored = new Set();

    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.hits = 0;
    this.misses = 0;

    this.detected = null;
    this.detectedAt = 0;

    this.particles = [];

    this.metronomeEnabled = true;
    this.beatFlashAt = -9999;
    this.beatAccent = false;

    // Background music
    this.audioBuffers = new Map();
    this._bgSrc = null;
    this._bgGain = null;
    this.bgVolume = 0.35;

    // Pitch stability
    this._pitchBuf = [];

    // Score layout
    this._scoreData = null;
    this._rests = [];
    this._scrollY = 0;
    this._scrollTarget = 0;

    this._resize();
    window.addEventListener("resize", () => this._resize());
  }

  _resize() {
    const c = this.canvas;
    c.width = c.offsetWidth || window.innerWidth;
    c.height = c.offsetHeight || window.innerHeight - 80;
  }

  // ── Setup ────────────────────────────────────────────────────
  setup(song, difficulty, speedMult, saxType) {
    this.song = song;
    this.difficulty = difficulty;
    this.speedMult = speedMult;
    this.saxType = saxType;

    this.notes = song.notes.map((n, i) => ({ ...n, id: i, state: "pending" }));
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.hits = 0;
    this.misses = 0;
    this.scored = new Set();
    this.particles = [];
    this.detected = null;
    this.beatFlashAt = -9999;
    this._pitchBuf = [];
    this._scrollY = 0;
    this._scrollTarget = 0;

    this._buildScore();

    this.detector.onPitch = (_freq, note) => {
      this._pitchBuf.push(note.midi);
      if (this._pitchBuf.length > 5) this._pitchBuf.shift();
      if (this._pitchBuf.length >= 3) {
        const last3 = this._pitchBuf.slice(-3);
        const spread = Math.max(...last3) - Math.min(...last3);
        if (spread <= 1) {
          const sorted = [...last3].sort((a, b) => a - b);
          const stableMidi = sorted[1];
          const stableNote = {
            ...note,
            midi: stableMidi,
            name: midiToNoteName(stableMidi),
          };
          this.detected = stableNote;
          this.detectedAt = Date.now();
          this.callbacks.onDetectedNote?.(this._writtenName(stableNote.name));
        }
      }
    };
    this.detector.onSilence = () => {
      this._pitchBuf = [];
      if (Date.now() - this.detectedAt > 200) {
        this.detected = null;
        this.callbacks.onDetectedNote?.("—");
      }
    };

    this.callbacks.onScoreUpdate?.(0, 0, 100);
    this.callbacks.onDetectedNote?.("—");
  }

  // ── Score layout build ───────────────────────────────────────
  _buildScore() {
    const BEATS_PER_MEASURE = 4;
    const bpm = this.song.bpm;
    const spb = 60 / bpm;
    const firstNoteTime = this.notes.length ? this.notes[0].time : 0;

    for (const note of this.notes) {
      // Always snap durationBeats — either convert from seconds or re-snap a
      // pre-existing value that may carry float drift from a prior import.
      if (note.durationBeats === undefined) {
        note.durationBeats = snapToMusical(note.duration / spb);
      } else {
        note.durationBeats = snapToMusical(note.durationBeats);
      }

      // Snap beatStart to the nearest 1/8-beat grid to kill float drift before
      // it reaches measureIndex / beatInMeasure arithmetic.
      if (note.beatStart === undefined) {
        note.beatStart =
          Math.round(((note.time - firstNoteTime) / spb) * 8) / 8;
      }
      note.measureIndex = Math.floor(note.beatStart / BEATS_PER_MEASURE);
      note.beatInMeasure =
        note.beatStart - note.measureIndex * BEATS_PER_MEASURE;
    }

    const lastNote = this.notes.reduce(
      (a, b) =>
        a.beatStart + a.durationBeats > b.beatStart + b.durationBeats ? a : b,
      this.notes[0] ?? { beatStart: 0, durationBeats: 0 },
    );
    const totalBeats = lastNote.beatStart + lastNote.durationBeats;
    const numMeasures = Math.max(1, Math.ceil(totalBeats / BEATS_PER_MEASURE));

    this._rests = this._computeRests(numMeasures, BEATS_PER_MEASURE);
    this._buildBeamGroups();

    this._scoreData = {
      numMeasures,
      beatsPerMeasure: BEATS_PER_MEASURE,
      firstNoteTime,
    };
  }

  _computeRests(numMeasures, beatsPerMeasure) {
    const rests = [];
    for (let m = 0; m < numMeasures; m++) {
      const measureNotes = this.notes
        .filter((n) => n.measureIndex === m)
        .sort((a, b) => a.beatInMeasure - b.beatInMeasure);

      let pos = 0;
      for (const note of measureNotes) {
        if (note.beatInMeasure > pos + 0.02) {
          rests.push({
            measureIndex: m,
            beatInMeasure: pos,
            // Snap so _drawRest receives a clean musical value
            durationBeats: snapToMusical(note.beatInMeasure - pos),
          });
        }
        pos = Math.max(pos, note.beatInMeasure + note.durationBeats);
      }
      if (pos < beatsPerMeasure - 0.02) {
        rests.push({
          measureIndex: m,
          beatInMeasure: pos,
          durationBeats: snapToMusical(beatsPerMeasure - pos),
        });
      }
    }
    return rests;
  }

  _buildBeamGroups() {
    for (const note of this.notes) note.beamGroupId = -1;

    const sorted = [...this.notes].sort((a, b) => a.beatStart - b.beatStart);
    let groupId = 0;
    let cur = [];

    const flush = () => {
      if (cur.length >= 2) {
        const id = groupId++;
        cur.forEach((n) => { n.beamGroupId = id; });
      }
      cur = [];
    };

    for (const note of sorted) {
      // Eighth (0.5) and sixteenth (0.25) are beamable.
      // Use <= 0.52 instead of <= 0.5 as a float-safety margin — after
      // snapToMusical the value should be exact, but this guards against
      // any residual drift from pre-snapped song data.
      if (note.durationBeats <= 0.52) {
        if (cur.length === 0) {
          cur.push(note);
        } else {
          const prev = cur[cur.length - 1];
          const gap = note.beatStart - (prev.beatStart + prev.durationBeats);
          // 0.03-beat gap tolerance absorbs rounding after snapping.
          // Also enforce the 4/4 half-measure beam-break rule: beams must not
          // cross the beat-2 → beat-3 boundary (beatInMeasure 1.5 → 2.0).
          const prevHalf = Math.floor(prev.beatInMeasure / 2);
          const noteHalf = Math.floor(note.beatInMeasure / 2);
          const sameHalf = prevHalf === noteHalf;
          if (gap < 0.03 && note.measureIndex === prev.measureIndex && sameHalf) {
            cur.push(note);
          } else {
            flush();
            cur.push(note);
          }
        }
      } else {
        flush();
      }
    }
    flush();
  }

  // ── Start / Pause / Stop ────────────────────────────────────
  begin() {
    this.startTime = performance.now() / 1000;
    this.isPlaying = true;
    this.isPaused = false;

    if (this.metronomeEnabled && this.detector.audioCtx) {
      this.metronome.init(this.detector.audioCtx);
      this.metronome.onBeat = (accent) => {
        this.beatFlashAt = performance.now();
        this.beatAccent = accent;
        this.callbacks.onBeat?.(accent);
      };
      this.metronome.start(this.song.bpm * this.speedMult);
    }

    this._startBgMusic(0);
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this._loop();
  }

  pause() {
    if (!this.isPlaying || this.isPaused) return;
    this.isPaused = true;
    this.isPlaying = false;
    cancelAnimationFrame(this.rafId);
    this.metronome.stop();
    this._stopBgMusic();
  }

  resume() {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.isPlaying = true;
    this.startTime = performance.now() / 1000 - this.gameTime / this.speedMult;
    if (this.metronomeEnabled && this.detector.audioCtx) {
      this.metronome.start(this.song.bpm * this.speedMult);
    }
    this._startBgMusic(this.gameTime);
    this._loop();
  }

  stop() {
    this.isPlaying = false;
    this.isPaused = false;
    cancelAnimationFrame(this.rafId);
    this.metronome.stop();
    this._stopBgMusic();
  }

  destroy() {
    this.stop();
    window.removeEventListener("resize", () => this._resize());
  }

  // ── Game loop ────────────────────────────────────────────────
  _loop() {
    if (!this.isPlaying) return;
    this.rafId = requestAnimationFrame(() => this._loop());
    this.gameTime =
      (performance.now() / 1000 - this.startTime) * this.speedMult;
    this._update();
    this._render();
  }

  // ── Update / scoring ─────────────────────────────────────────
  _update() {
    const HIT_W = 0.28,
      PERF_W = 0.09,
      GOOD_W = 0.18;
    const total = this.notes.length;
    const songEnd = (this.notes[total - 1]?.time ?? 0) + 3;

    for (const note of this.notes) {
      if (this.scored.has(note.id)) continue;
      const dt = note.time - this.gameTime;

      if (dt < -HIT_W) {
        this.scored.add(note.id);
        if (note.state === "pending") {
          note.state = "miss";
          this.misses++;
          this.combo = 0;
          this.callbacks.onFeedback?.("MISS", "#ef4444");
          this._emitScore();
        }
        continue;
      }

      if (Math.abs(dt) <= HIT_W && this.detected) {
        if (this._matchesNote(note.note, this.detected)) {
          this.scored.add(note.id);
          note.state = "hit";
          this.hits++;
          this.combo++;
          if (this.combo > this.maxCombo) this.maxCombo = this.combo;

          const mult = Math.min(1 + Math.floor(this.combo / 8), 4);
          let pts, label, color;
          if (Math.abs(dt) <= PERF_W) {
            pts = 300 * mult;
            label = "PERFEITO!";
            color = "#22c55e";
          } else if (Math.abs(dt) <= GOOD_W) {
            pts = 150 * mult;
            label = "BOM!";
            color = "#f59e0b";
          } else {
            pts = 50 * mult;
            label = "OK";
            color = "#94a3b8";
          }

          this.score += pts;
          this.callbacks.onFeedback?.(
            `${label}${mult > 1 ? "  x" + mult : ""}`,
            color,
          );
          this._spawnParticles(note);
          this._emitScore();
        }
      }
    }

    const progress = Math.min(this.gameTime / songEnd, 1);
    this.callbacks.onProgress?.(progress);
    if (this.gameTime > songEnd) this._endGame();

    this.particles = this.particles.filter((p) => p.life > 0);
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.12;
      p.life -= 0.022;
      p.r *= 0.97;
    }
  }

  _emitScore() {
    const total = this.hits + this.misses;
    const accuracy = total ? Math.round((this.hits / total) * 100) : 100;
    this.callbacks.onScoreUpdate?.(this.score, this.combo, accuracy);
  }

  _matchesNote(target, detected) {
    const tol = this.difficulty === "easy" ? 1 : 0;
    return Math.abs(noteNameToMidi(target) - detected.midi) <= tol;
  }

  _endGame() {
    this.isPlaying = false;
    cancelAnimationFrame(this.rafId);
    this.metronome.stop();
    this._stopBgMusic();

    const total = this.notes.length;
    const acc = total ? Math.round((this.hits / total) * 100) : 0;
    const grade =
      acc >= 95
        ? "S"
        : acc >= 85
          ? "A"
          : acc >= 70
            ? "B"
            : acc >= 55
              ? "C"
              : "D";

    this.callbacks.onEnd?.({
      grade,
      score: this.score,
      accuracy: acc,
      hits: this.hits,
      total,
      maxCombo: this.maxCombo,
    });
  }

  // ── Background music ─────────────────────────────────────────
  storeAudioBuffer(songId, buf) {
    this.audioBuffers.set(songId, buf);
  }

  async preloadAudioSrc(song) {
    if (!song?.audioSrc || this.audioBuffers.has(song.id)) return;
    try {
      const resp = await fetch(song.audioSrc);
      if (!resp.ok) return;
      const arrayBuf = await resp.arrayBuffer();
      const tmpCtx = new AudioContext();
      const audioBuf = await tmpCtx.decodeAudioData(arrayBuf);
      await tmpCtx.close();
      this.audioBuffers.set(song.id, audioBuf);
    } catch (e) {
      console.warn("[GameEngine] Could not load audio:", song.audioSrc, e);
    }
  }

  _startBgMusic(offsetSec) {
    this._stopBgMusic();
    if (!this.song) return;
    const buf = this.audioBuffers.get(this.song.id);
    if (!buf || !this.detector.audioCtx) return;

    const ctx = this.detector.audioCtx;
    const gain = ctx.createGain();
    gain.gain.value = this.bgVolume;
    gain.connect(ctx.destination);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = this.speedMult;
    src.connect(gain);

    const audioOffset = Math.min(
      Math.max(offsetSec / this.speedMult, 0),
      buf.duration - 0.01,
    );
    src.start(0, audioOffset);

    this._bgSrc = src;
    this._bgGain = gain;
  }

  _stopBgMusic() {
    if (this._bgSrc) {
      try {
        this._bgSrc.stop();
      } catch (_) {}
      this._bgSrc = null;
      this._bgGain = null;
    }
  }

  setBgVolume(vol) {
    this.bgVolume = vol;
    if (this._bgGain) this._bgGain.gain.value = vol;
  }

  setMetronomeEnabled(enabled) {
    this.metronomeEnabled = enabled;
    if (this.isPlaying) {
      if (enabled) {
        this.metronome.init(this.detector.audioCtx);
        this.metronome.start(this.song.bpm * this.speedMult);
      } else {
        this.metronome.stop();
      }
    }
  }

  // ── Transposition ─────────────────────────────────────────────
  _writtenName(concertNote) {
    const offset = SAX_TRANSPOSITIONS[this.saxType] ?? 0;
    if (offset === 0) return concertNote;
    return midiToNoteName(noteNameToMidi(concertNote) + offset);
  }

  // ── Layout helpers ────────────────────────────────────────────
  _getLayout() {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const ls = Math.max(11, Math.min(17, H / 26));
    const clefW = ls * 8.2; // space for clef + time signature
    const measPerRow = 4;
    const measureW = (W - clefW) / measPerRow;
    const staffH = 4 * ls;
    const rowH = staffH + ls * 7.5;
    const topPad = ls * 4.5;
    return { W, H, ls, clefW, measPerRow, measureW, staffH, rowH, topPad };
  }

  // x position of a note within a measure (proportional to beat)
  _noteX(beatInMeasure, beatsPerMeasure, measureStartX, measureW) {
    // Proportional padding so spacing scales with the canvas — notes never
    // crowd the barline on wide canvases or get clipped on narrow ones.
    const lPad = measureW * 0.10;
    const rPad = measureW * 0.05;
    return (
      measureStartX +
      lPad +
      (beatInMeasure / beatsPerMeasure) * (measureW - lPad - rPad)
    );
  }

  // Canvas position of a note (for particles, etc.)
  _getNoteScreenPos(note) {
    if (!this._scoreData) return null;
    const L = this._getLayout();
    const { ls, clefW, measPerRow, measureW, rowH, topPad } = L;
    const { beatsPerMeasure } = this._scoreData;
    const row = Math.floor(note.measureIndex / measPerRow);
    const mOff = note.measureIndex - row * measPerRow;
    const x = this._noteX(
      note.beatInMeasure,
      beatsPerMeasure,
      clefW + mOff * measureW,
      measureW,
    );
    const rowTop = topPad + row * rowH - this._scrollY;
    const wn = this._writtenName(note.note);
    return { x, y: staffNoteY(wn, rowTop, ls) };
  }

  // ── Particles ────────────────────────────────────────────────
  _spawnParticles(note) {
    const pos = this._getNoteScreenPos(note);
    if (!pos) return;
    for (let i = 0; i < 14; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 2 + Math.random() * 4;
      this.particles.push({
        x: pos.x + (Math.random() - 0.5) * 18,
        y: pos.y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd - 2.5,
        r: 3 + Math.random() * 4,
        color: "#22c55e",
        life: 1,
      });
    }
  }

  // ── Render ────────────────────────────────────────────────────
  _render() {
    if (!this._scoreData) return;

    const ctx = this.ctx;
    const L = this._getLayout();
    const { W, H, ls, staffH, rowH, topPad } = L;
    const { numMeasures, beatsPerMeasure, firstNoteTime } = this._scoreData;

    // Current beat relative to first note
    const currentBeat = ((this.gameTime - firstNoteTime) * this.song.bpm) / 60;
    const totalRows = Math.ceil(numMeasures / L.measPerRow);
    const activeMeasure = Math.max(
      0,
      Math.floor(currentBeat / beatsPerMeasure),
    );
    const activeRow = Math.min(
      totalRows - 1,
      Math.floor(activeMeasure / L.measPerRow),
    );

    // Smooth scroll
    const targetY = Math.max(0, activeRow * rowH - H * 0.08);
    this._scrollY += (targetY - this._scrollY) * 0.07;

    // Background (cream/white for sheet music)
    ctx.fillStyle = "#f2f3f5";
    ctx.fillRect(0, 0, W, H);

    // Visible rows
    const firstRow = Math.max(0, Math.floor((this._scrollY - topPad) / rowH));
    const lastRow = Math.min(totalRows - 1, firstRow + Math.ceil(H / rowH) + 1);

    for (let row = firstRow; row <= lastRow; row++) {
      const rowTop = topPad + row * rowH - this._scrollY;
      if (rowTop > H + staffH + ls * 4) continue;
      if (rowTop + staffH < -ls * 5) continue;
      this._drawRow(ctx, L, row, rowTop, currentBeat, activeRow);
    }

    // Metronome indicator
    this._drawMetronomeIndicator(ctx, W, H);

    // Particles
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 10;
      ctx.shadowColor = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.1, p.r), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── Draw one row of the score ────────────────────────────────
  _drawRow(ctx, L, row, rowTop, currentBeat, activeRow) {
    const { W, ls, clefW, measPerRow, measureW, staffH } = L;
    const { numMeasures, beatsPerMeasure } = this._scoreData;

    const firstMeasure = row * measPerRow;
    const lastMeasure = Math.min(
      numMeasures - 1,
      firstMeasure + measPerRow - 1,
    );
    const bot = rowTop + staffH;

    // White band for staff area — extra margin so beamed-group stems that
    // extend well above/below the staff don't bleed into the grey background.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, rowTop - ls * 4.5, W, staffH + ls * 9.0);

    // 5 staff lines (from start of clef area to end of row)
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      ctx.strokeStyle = "#999";
      ctx.beginPath();
      ctx.moveTo(clefW - 2, rowTop + i * ls);
      ctx.lineTo(W, rowTop + i * ls);
      ctx.stroke();
    }

    // Opening barline
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(clefW - 2, rowTop);
    ctx.lineTo(clefW - 2, bot);
    ctx.stroke();

    // Treble clef
    ctx.fillStyle = "#222";
    ctx.font = `${ls * 7}px 'Times New Roman', Georgia, serif`;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillText("\uD834\uDD1E", 2, bot + ls * 0.65);

    // Time signature 4/4
    const tsX = ls * 5.9;
    ctx.fillStyle = "#222";
    ctx.font = `bold ${ls * 1.9}px 'Times New Roman', Georgia, serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("4", tsX, rowTop + ls * 1.0);
    ctx.fillText("4", tsX, rowTop + ls * 3.0);

    // Measure barlines + numbers
    for (let m = firstMeasure; m <= lastMeasure; m++) {
      const mOff = m - firstMeasure;
      const bx = clefW + (mOff + 1) * measureW;

      const isLastMeasure = m === numMeasures - 1;
      if (isLastMeasure) {
        // Final double barline: thin + thick, spaced by ~0.4 spaces
        ctx.strokeStyle = "#555";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(bx - ls * 0.42, rowTop);
        ctx.lineTo(bx - ls * 0.42, bot);
        ctx.stroke();
        ctx.lineWidth = ls * 0.22;
        ctx.lineCap = "butt";
        ctx.beginPath();
        ctx.moveTo(bx, rowTop);
        ctx.lineTo(bx, bot);
        ctx.stroke();
      } else {
        // Regular barline — slightly lighter than the opening barline so
        // notes and beams read before the bar structure.
        ctx.strokeStyle = "#aaa";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(bx, rowTop);
        ctx.lineTo(bx, bot);
        ctx.stroke();
      }

      // Measure number — small, subtle label above the barline
      ctx.fillStyle = "#bbb";
      ctx.font = `${ls * 0.65}px sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(m + 1, clefW + mOff * measureW + 3, rowTop - ls * 0.5);
    }

    // Rests
    for (const rest of this._rests) {
      if (rest.measureIndex < firstMeasure || rest.measureIndex > lastMeasure)
        continue;
      const mOff = rest.measureIndex - firstMeasure;
      const x = this._noteX(
        rest.beatInMeasure,
        beatsPerMeasure,
        clefW + mOff * measureW,
        measureW,
      );
      this._drawRest(ctx, rest.durationBeats, x, rowTop, ls);
    }

    // Collect beam groups for this row
    const beamGroupsMap = new Map();
    for (const note of this.notes) {
      if (note.measureIndex < firstMeasure || note.measureIndex > lastMeasure)
        continue;
      if (note.beamGroupId >= 0) {
        if (!beamGroupsMap.has(note.beamGroupId))
          beamGroupsMap.set(note.beamGroupId, []);
        beamGroupsMap.get(note.beamGroupId).push(note);
      }
    }

    // Notes
    for (const note of this.notes) {
      if (note.measureIndex < firstMeasure || note.measureIndex > lastMeasure)
        continue;
      const wn = this._writtenName(note.note);
      const mOff = note.measureIndex - firstMeasure;
      const x = this._noteX(
        note.beatInMeasure,
        beatsPerMeasure,
        clefW + mOff * measureW,
        measureW,
      );
      const y = staffNoteY(wn, rowTop, ls);
      this._drawNoteShape(
        ctx,
        note,
        wn,
        x,
        y,
        rowTop,
        ls,
        note.beamGroupId >= 0,
      );
    }

    // Beams
    for (const [, groupNotes] of beamGroupsMap) {
      this._drawBeam(ctx, L, groupNotes, firstMeasure, rowTop);
    }

    // Cursor
    if (activeRow === row) {
      const curMeasure = Math.floor(currentBeat / beatsPerMeasure);
      const clamped = Math.max(firstMeasure, Math.min(lastMeasure, curMeasure));
      const beatInM = Math.max(0, currentBeat - clamped * beatsPerMeasure);
      const mOff = clamped - firstMeasure;
      const cursorX = this._noteX(
        beatInM,
        beatsPerMeasure,
        clefW + mOff * measureW,
        measureW,
      );
      this._drawCursor(ctx, cursorX, rowTop, staffH, ls);
    }
  }

  // ── Note shape rendering ─────────────────────────────────────
  _drawNoteShape(
    ctx,
    note,
    writtenNote,
    x,
    y,
    staffTopY,
    ls,
    isBeamed = false,
  ) {
    // Snap here as a last-resort safety net in case note.durationBeats was set
    // externally (e.g. live song import) and bypassed _buildScore snapping.
    const dur = snapToMusical(note.durationBeats ?? 1);
    const step = diatonicStep(writtenNote);
    const stemUp = step < 6;

    const color =
      note.state === "hit"
        ? "#15803d"
        : note.state === "miss"
          ? "#b91c1c"
          : "#1a1a2e";

    // ── Note-type classification ───────────────────────────────
    // Detect dotted values first; then extract the base duration.
    // With snapped values the tolerances below are generous on purpose —
    // they make the renderer resilient even if a caller skips snapping.
    const hasDot =
      Math.abs(dur - 3.0)  < 0.13 ||   // dotted half
      Math.abs(dur - 1.5)  < 0.13 ||   // dotted quarter
      Math.abs(dur - 0.75) < 0.13;     // dotted eighth

    // baseDur is the undotted equivalent (2, 1, or 0.5 respectively)
    const baseDur = hasDot ? dur / 1.5 : dur;

    const isWhole     = baseDur >= 4.0 - 0.13;
    const isHalf      = !isWhole && baseDur >= 2.0 - 0.13;
    // isQuarter: everything between half and eighth
    const isQuarter   = !isWhole && !isHalf && baseDur >= 1.0 - 0.13;
    const isEighth    = !isWhole && !isHalf && !isQuarter && baseDur >= 0.5 - 0.13;
    const isSixteenth = !isWhole && !isHalf && !isQuarter && !isEighth; // 0.25
    // Open noteheads for whole and half (and dotted half)
    const isFilled    = !isWhole && !isHalf;

    const rx = isWhole ? ls * 0.58 : ls * 0.5;
    const ry = isWhole ? ls * 0.36 : ls * 0.32;

    // Ledger lines
    this._drawLedgerLines(ctx, step, x, staffTopY, ls, rx, color);

    // Notehead
    ctx.save();
    if (note.state === "hit") {
      ctx.shadowBlur = 14;
      ctx.shadowColor = "#22c55e";
    }
    if (note.state === "miss") {
      ctx.shadowBlur = 10;
      ctx.shadowColor = "#ef4444";
    }

    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, -0.18, 0, Math.PI * 2);
    if (isFilled) {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      // Open notehead: white fill first (covers staff lines), then stroke
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = ls * 0.13;
      ctx.stroke();
    }
    ctx.restore();

    // Accidental — vertically centered on the notehead (not offset)
    const acc = writtenNote.match(/^[A-G](#|b)/);
    if (acc) {
      ctx.save();
      ctx.fillStyle = color;
      ctx.font = `bold ${ls * 1.05}px 'Times New Roman', serif`;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(acc[1] === "#" ? "\u266F" : "\u266D", x - rx - 3, y);
      ctx.restore();
    }

    // Augmentation dot — placed in the space to the right of the notehead.
    // If the note sits on a staff line (even diatonic step) nudge the dot
    // up by one diatonic step (ls * 0.5) into the space above.
    if (hasDot) {
      const dotY = step % 2 === 0 ? y - ls * 0.5 : y;
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + rx + ls * 0.55, dotY, ls * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Stem + flags — skipped for whole notes and beamed notes
    // (beamed notes get their stems drawn by _drawBeam)
    if (!isWhole && !isBeamed) {
      const stemLen = ls * 3.5;
      const stemX = stemUp ? x + rx * 0.82 : x - rx * 0.82;
      const stemEndY = stemUp ? y - stemLen : y + stemLen;

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = ls * 0.1;
      ctx.lineCap = "butt";
      ctx.beginPath();
      ctx.moveTo(stemX, y + (stemUp ? -ry * 0.4 : ry * 0.4));
      ctx.lineTo(stemX, stemEndY);
      ctx.stroke();
      ctx.restore();

      const flags = isSixteenth ? 2 : isEighth ? 1 : 0;
      if (flags > 0)
        this._drawFlags(ctx, stemX, stemEndY, stemUp, flags, ls, color);
    }
  }

  // ── Flag rendering ────────────────────────────────────────────
  _drawFlags(ctx, stemX, stemTopY, stemUp, numFlags, ls, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = ls * 0.13;
    ctx.lineCap = "round";

    for (let f = 0; f < numFlags; f++) {
      const yStart = stemTopY + (stemUp ? f * ls * 0.65 : -f * ls * 0.65);
      const dir = stemUp ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(stemX, yStart);
      ctx.bezierCurveTo(
        stemX + ls * 1.9,
        yStart + dir * ls * 0.3,
        stemX + ls * 1.8,
        yStart + dir * ls * 1.3,
        stemX + ls * 0.4,
        yStart + dir * ls * 2.1,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Beam rendering ────────────────────────────────────────────
  //
  // Engraving rules implemented here:
  //  • Beam direction decided by majority vote (same as before).
  //  • Beam slope follows 30% of the melodic contour between first and last
  //    note, capped at ±0.4 spaces total rise so the angle stays readable.
  //  • The beam's y-intercept is set so that the first note has a preferred
  //    stem length (3.5 spaces); then every note is checked and the beam is
  //    pushed away from the noteheads until no stem is shorter than 2.8 spaces.
  //  • Stems are drawn individually to the exact beam y at their x position.
  //  • The beam itself is a filled parallelogram (not a flat rectangle) so
  //    the slope is visible.
  //  • A second parallel beam is drawn for sixteenth-note pairs.
  _drawBeam(ctx, L, groupNotes, firstMeasure, rowTop) {
    if (groupNotes.length < 2) return;

    const { ls, clefW, measureW } = L;
    const { beatsPerMeasure } = this._scoreData;

    const rx      = ls * 0.5;
    const ry      = ls * 0.32;
    const BEAM_H  = ls * 0.42;  // beam bar thickness
    const BEAM_G  = ls * 0.26;  // gap between primary and secondary bar
    const PREF    = ls * 3.5;   // preferred stem length (notehead → beam outer edge)
    const MIN     = ls * 2.8;   // minimum stem length

    const sorted = [...groupNotes].sort((a, b) => a.beatStart - b.beatStart);

    // ── Build per-note data ──────────────────────────────────────
    const nd = sorted.map((note) => {
      const wn   = this._writtenName(note.note);
      const step = diatonicStep(wn);
      const mOff = note.measureIndex - firstMeasure;
      const x    = this._noteX(note.beatInMeasure, beatsPerMeasure,
                               clefW + mOff * measureW, measureW);
      const y    = staffNoteY(wn, rowTop, ls);
      return { x, y, step, note };
    });

    // ── Beam direction: majority vote ────────────────────────────
    const beamUp = nd.filter((n) => n.step < 6).length >= nd.length / 2;

    // Stem attachment X: right side of head for stem-up, left for stem-down
    const stemXof = (n) => beamUp ? n.x + rx * 0.82 : n.x - rx * 0.82;

    const x0    = stemXof(nd[0]);
    const xN    = stemXof(nd[nd.length - 1]);
    const xSpan = xN - x0 || 1;

    // ── Beam slope ───────────────────────────────────────────────
    // Follow 30% of the melodic interval between first and last note,
    // capped so the total rise/fall across the group ≤ 0.4 spaces.
    const melodicDelta = nd[nd.length - 1].y - nd[0].y; // positive = melody falls
    const rawDelta     = melodicDelta * 0.30;
    const beamDelta    = Math.max(-ls * 0.40, Math.min(ls * 0.40, rawDelta));
    const slope        = beamDelta / xSpan;

    // Beam anchor Y at a given stem x (the outer edge — top for up, bottom for down)
    // Initialise from first note's preferred stem length, then push out as needed.
    let b0 = beamUp ? nd[0].y - PREF : nd[0].y + PREF;

    // Single-pass: find the most-constraining note and shift b0 accordingly.
    // For beamUp  we need: b0 + slope*(sx-x0) ≤ n.y - MIN  →  push b0 down (smaller Y).
    // For beamDown we need: b0 + slope*(sx-x0) ≥ n.y + MIN  →  push b0 up  (larger Y).
    for (const n of nd) {
      const sx = stemXof(n);
      const a  = slope * (sx - x0);          // contribution from slope at this x
      if (beamUp)   b0 = Math.min(b0, n.y - MIN - a);
      else          b0 = Math.max(b0, n.y + MIN - a);
    }

    // Beam anchor Y at any x after the b0 adjustment
    const anchorY = (x) => b0 + slope * (x - x0);

    // ── Colors ───────────────────────────────────────────────────
    const stateColor = (n) =>
      n.note.state === "hit"  ? "#15803d" :
      n.note.state === "miss" ? "#b91c1c" : "#1a1a2e";
    const allHit  = sorted.every((n) => n.state === "hit");
    const allMiss = sorted.every((n) => n.state === "miss");
    const beamClr = allHit ? "#15803d" : allMiss ? "#b91c1c" : "#1a1a2e";

    // ── Draw stems ───────────────────────────────────────────────
    // Each stem runs from the notehead edge to the beam's outer edge.
    // The beam parallelogram will then fill the BEAM_H thickness inward.
    ctx.lineWidth = ls * 0.11;
    ctx.lineCap   = "butt";
    for (const n of nd) {
      const sx  = stemXof(n);
      const tip = anchorY(sx); // outer edge of beam at this stem
      ctx.save();
      ctx.strokeStyle = stateColor(n);
      ctx.beginPath();
      ctx.moveTo(sx, n.y + (beamUp ? -ry * 0.4 : ry * 0.4));
      ctx.lineTo(sx, tip);
      ctx.stroke();
      ctx.restore();
    }

    // ── Draw beam parallelogram helper ───────────────────────────
    // Draws a filled sloped bar from stemX xa to stemX xb.
    // yOffset shifts the bar perpendicular to the beam axis (for second beam).
    const fillBeam = (xa, xb, yOffset) => {
      const ya = anchorY(xa) + yOffset;
      const yb = anchorY(xb) + yOffset;
      const h  = beamUp ? BEAM_H : -BEAM_H; // thickness toward noteheads
      ctx.beginPath();
      ctx.moveTo(xa, ya);
      ctx.lineTo(xb, yb);
      ctx.lineTo(xb, yb + h);
      ctx.lineTo(xa, ya + h);
      ctx.closePath();
      ctx.fill();
    };

    ctx.fillStyle = beamClr;

    // Primary beam spanning the full group
    fillBeam(x0, xN, 0);

    // Secondary beam for sixteenth-note pairs (parallel, offset by one beam thickness + gap)
    const off2 = beamUp ? -(BEAM_H + BEAM_G) : BEAM_H + BEAM_G;
    for (let i = 0; i < nd.length - 1; i++) {
      if (nd[i].note.durationBeats <= 0.26 && nd[i + 1].note.durationBeats <= 0.26) {
        fillBeam(stemXof(nd[i]), stemXof(nd[i + 1]), off2);
      }
    }
  }

  // ── Rest symbols ─────────────────────────────────────────────
  _drawRest(ctx, durRaw, x, staffTopY, ls) {
    // Snap the incoming duration so _drawRest is robust even when called
    // before snapping has propagated (e.g. during the first render frame).
    const dur = snapToMusical(durRaw);

    // Detect dotted rests (3 = dotted half, 1.5 = dotted quarter, 0.75 = dotted eighth)
    const isDotted =
      Math.abs(dur - 3.0)  < 0.13 ||
      Math.abs(dur - 1.5)  < 0.13 ||
      Math.abs(dur - 0.75) < 0.13;
    const baseDur = isDotted ? dur / 1.5 : dur;

    ctx.save();
    ctx.fillStyle = "#555";
    ctx.strokeStyle = "#555";

    if (baseDur >= 4 - 0.13) {
      // Whole rest: filled rectangle hanging below line D5 (index 1 from top)
      ctx.fillRect(x - ls * 0.55, staffTopY + ls - ls * 0.42, ls * 1.1, ls * 0.42);
    } else if (baseDur >= 2 - 0.13) {
      // Half rest: filled rectangle sitting on line B4 (index 2 from top)
      ctx.fillRect(x - ls * 0.55, staffTopY + ls * 2, ls * 1.1, ls * 0.42);
    } else if (baseDur >= 1 - 0.13) {
      this._drawQuarterRest(ctx, x, staffTopY + ls * 2, ls);
    } else if (baseDur >= 0.5 - 0.13) {
      this._drawEighthRest(ctx, x, staffTopY + ls * 2, ls);
    } else {
      // Sixteenth rest: two eighth-rest symbols staggered vertically
      this._drawEighthRest(ctx, x, staffTopY + ls * 1.5, ls);
      this._drawEighthRest(ctx, x + ls * 0.3, staffTopY + ls * 2.5, ls);
    }

    // Augmentation dot for dotted rests — placed in the third space from bottom
    if (isDotted) {
      ctx.fillStyle = "#555";
      ctx.beginPath();
      ctx.arc(x + ls * 0.9, staffTopY + ls * 1.5, ls * 0.17, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  _drawQuarterRest(ctx, x, midY, ls) {
    ctx.save();
    ctx.strokeStyle = "#555";
    ctx.lineWidth = ls * 0.12;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const w = ls * 0.52,
      h = ls * 1.85;
    const t = midY - h / 2;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.5, t);
    ctx.lineTo(x - w * 0.4, t + h * 0.22);
    ctx.lineTo(x + w * 0.6, t + h * 0.44);
    ctx.bezierCurveTo(
      x + w * 1.1,
      t + h * 0.58,
      x - w * 0.9,
      t + h * 0.8,
      x - w * 0.4,
      t + h,
    );
    ctx.stroke();
    ctx.restore();
  }

  _drawEighthRest(ctx, x, midY, ls) {
    ctx.save();
    ctx.strokeStyle = "#555";
    ctx.lineWidth = ls * 0.12;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x - ls * 0.25, midY + ls * 0.65);
    ctx.lineTo(x + ls * 0.35, midY - ls * 0.65);
    ctx.stroke();
    ctx.fillStyle = "#555";
    ctx.beginPath();
    ctx.arc(x + ls * 0.3, midY - ls * 0.48, ls * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ── Cursor ────────────────────────────────────────────────────
  _drawCursor(ctx, cursorX, rowTop, staffH, ls) {
    const grad = ctx.createLinearGradient(
      0,
      rowTop - ls * 2,
      0,
      rowTop + staffH + ls * 2,
    );
    grad.addColorStop(0, "rgba(109,40,217,0)");
    grad.addColorStop(0.2, "rgba(109,40,217,0.65)");
    grad.addColorStop(0.5, "rgba(124,58,237,0.90)");
    grad.addColorStop(0.8, "rgba(109,40,217,0.65)");
    grad.addColorStop(1, "rgba(109,40,217,0)");

    ctx.fillStyle = grad;
    ctx.fillRect(cursorX - 1.5, rowTop - ls * 2, 3, staffH + ls * 4);
  }

  // ── Ledger lines ─────────────────────────────────────────────
  _drawLedgerLines(ctx, step, x, staffTopY, ls, halfW, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.3;
    const hw = halfW * 1.95;

    const draw = (s) => {
      const ly = staffTopY + (10 - s) * (ls / 2);
      ctx.beginPath();
      ctx.moveTo(x - hw, ly);
      ctx.lineTo(x + hw, ly);
      ctx.stroke();
    };

    if (step <= 1) for (let s = 0; s >= step; s -= 2) draw(s);
    if (step >= 11) for (let s = 12; s <= step; s += 2) draw(s);
    ctx.restore();
  }

  // ── Metronome indicator ──────────────────────────────────────
  _drawMetronomeIndicator(ctx, W, H) {
    const cx = W - 48;
    const cy = H - 48;

    ctx.strokeStyle = "#ccc";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 22, 0, Math.PI * 2);
    ctx.stroke();

    if (!this.metronomeEnabled) {
      ctx.strokeStyle = "#bbb";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - 12, cy - 12);
      ctx.lineTo(cx + 12, cy + 12);
      ctx.stroke();
      ctx.fillStyle = "#bbb";
      ctx.font = "13px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("\u2669", cx, cy);
      return;
    }

    const beatAge = performance.now() - this.beatFlashAt;
    if (beatAge < 160) {
      const t = beatAge / 160;
      const alpha = 1 - t * t;
      const size = this.beatAccent ? 22 : 16;
      ctx.save();
      ctx.globalAlpha = alpha * 0.85;
      ctx.fillStyle = this.beatAccent ? "#7c3aed" : "#0891b2";
      ctx.shadowBlur = 20;
      ctx.shadowColor = ctx.fillStyle;
      ctx.beginPath();
      ctx.arc(cx, cy, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const bpm = this.song?.bpm ?? 100;
    ctx.fillStyle = beatAge < 160 ? "#333" : "#aaa";
    ctx.font = "bold 13px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("\u2669", cx, cy - 4);
    ctx.font = "10px monospace";
    ctx.fillStyle = "#bbb";
    ctx.fillText(bpm, cx, cy + 9);
  }
}
