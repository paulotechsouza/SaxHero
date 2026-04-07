/**
 * GameEngine — Renderizador de partitura + loop de jogo
 *
 * Responsabilidades:
 *  - Construir o layout estático da partitura (compassos, pausas, grupos de colcheia)
 *  - Executar o loop de animação (requestAnimationFrame) e avançar o tempo de jogo
 *  - Avaliar o pitch detectado contra as notas esperadas e calcular pontuação
 *  - Reproduzir a música de fundo e o metrônomo sincronizados com o jogo
 *  - Renderizar tudo no Canvas 2D (partitura, cursor, partículas, indicador de metrônomo)
 */

import { noteNameToMidi } from "./PitchDetector.js";

// ── Cores das notas (por nome de nota) ──────────────────────────
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

// ── Transposição por tipo de saxofone ────────────────────────
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

// ── Posicionamento diatônico na pauta (Clave de Sol) ─────────
// C4=0, D4=1, E4=2 … B4=6, C5=7 … (ignora acidentes)
export const DIATONIC = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

export function diatonicStep(noteName) {
  const m = noteName.match(/^([A-G])(#|b?)(\d)$/);
  if (!m) return 0;
  return (parseInt(m[3]) - 4) * 7 + DIATONIC[m[1]];
}

// Linha superior da pauta = F5 (passo 10). Cada passo diatônico = ls/2 pixels.
export function staffNoteY(noteName, staffTopY, ls) {
  return staffTopY + (10 - diatonicStep(noteName)) * (ls / 2);
}

// ── Arredondamento para duração musical padrão ────────────────
// Arredonda um valor de tempo bruto para a duração musical padrão mais próxima.
// Evita deriva de ponto flutuante (ex.: 0.499 → 0.5, 1.49 → 1.5) que quebraria
// a classificação do tipo de nota, agrupamento de colcheias e cálculo de pausas.
function snapToMusical(beats) {
  // Durações padrão em tempos (semínima = 1 tempo)
  // Inclui subfiguras curtas: semifusa (0,0625), fusa (0,125) e suas versões pontuadas
  const VALUES = [
    0.0625, 0.09375, 0.125, 0.1875, 0.25, 0.375, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0,
    4.0,
  ];
  const TOLERANCE = 0.07; // ±70 ms a 60 BPM — tolerância segura sem mascarar erros reais
  let best = beats,
    bestDist = Infinity;
  for (const v of VALUES) {
    const d = Math.abs(beats - v);
    if (d < bestDist) {
      bestDist = d;
      best = v;
    }
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

    // Música de fundo
    this.audioBuffers = new Map();
    this._bgSrc = null;
    this._bgGain = null;
    this.bgVolume = 0.35;

    // Estabilidade do pitch (buffer circular de leituras recentes)
    this._pitchBuf = [];

    // Layout da partitura (calculado em _buildScore)
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

  // ── Configuração inicial (chamado antes de begin()) ──────────────
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

  // ── Construção do layout da partitura ───────────────────────
  _buildScore() {
    const BEATS_PER_MEASURE = 4;
    const bpm = this.song.bpm;
    const spb = 60 / bpm;
    const firstNoteTime = this.notes.length ? this.notes[0].time : 0;

    for (const note of this.notes) {
      // Sempre arredonda durationBeats — converte de segundos se ausente ou
      // re-arredonda valor preexistente que pode ter deriva de ponto flutuante.
      if (note.durationBeats === undefined) {
        note.durationBeats = snapToMusical(note.duration / spb);
      } else {
        note.durationBeats = snapToMusical(note.durationBeats);
      }

      // Arredonda beatStart para o grid de 1/8 de tempo para eliminar deriva
      // antes de chegar ao cálculo de measureIndex / beatInMeasure.
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
            // Arredonda para que _drawRest receba um valor musical preciso
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
        cur.forEach((n) => {
          n.beamGroupId = id;
        });
      }
      cur = [];
    };

    for (const note of sorted) {
      // Colcheias (0,5), semicolcheias (0,25), fusas (0,125) e semifusas (0,0625) podem ser agrupadas.
      // Usa <= 0,52 como margem de segurança; subfiguras menores já são cobertas pois são < 0,52.
      if (note.durationBeats <= 0.52) {
        if (cur.length === 0) {
          cur.push(note);
        } else {
          const prev = cur[cur.length - 1];
          const gap = note.beatStart - (prev.beatStart + prev.durationBeats);
          // Tolerância de 0,03 tempos absorve arredondamentos após o snap.
          // Também aplica a regra de 4/4: ligaduras não cruzam a fronteira
          // tempo-2 → tempo-3 (beatInMeasure 1,5 → 2,0).
          const prevHalf = Math.floor(prev.beatInMeasure / 2);
          const noteHalf = Math.floor(note.beatInMeasure / 2);
          const sameHalf = prevHalf === noteHalf;
          if (
            gap < 0.03 &&
            note.measureIndex === prev.measureIndex &&
            sameHalf
          ) {
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

  // ── Iniciar / Pausar / Parar ────────────────────────────────
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

  // ── Loop principal de jogo ─────────────────────────────────
  _loop() {
    if (!this.isPlaying) return;
    this.rafId = requestAnimationFrame(() => this._loop());
    this.gameTime =
      (performance.now() / 1000 - this.startTime) * this.speedMult;
    this._update();
    this._render();
  }

  // ── Atualização / pontuação ──────────────────────────────────
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

  // ── Música de fundo ─────────────────────────────────────────
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
      console.warn(
        "[GameEngine] Não foi possível carregar áudio:",
        song.audioSrc,
        e,
      );
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

  // ── Transposição (tom de concerto → nota escrita) ──────────────
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

  // Posição X da nota dentro do compasso (proporcional ao tempo)
  _noteX(beatInMeasure, beatsPerMeasure, measureStartX, measureW) {
    // Padding proporcional para que o espaçamento escale com o canvas —
    // as notas nunca se amontoam na barra nem são cortadas em telas estreitas.
    const lPad = measureW * 0.1;
    const rPad = measureW * 0.05;
    return (
      measureStartX +
      lPad +
      (beatInMeasure / beatsPerMeasure) * (measureW - lPad - rPad)
    );
  }

  // Posição da nota no canvas (usada para partículas, etc.)
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

  // ── Partículas de acerto ───────────────────────────────────────
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

  // ── Renderização principal (chamada a cada frame) ──────────────
  _render() {
    if (!this._scoreData) return;

    const ctx = this.ctx;
    const L = this._getLayout();
    const { W, H, ls, staffH, rowH, topPad } = L;
    const { numMeasures, beatsPerMeasure, firstNoteTime } = this._scoreData;

    // Tempo atual relativo à primeira nota
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

    // Scroll suave
    const targetY = Math.max(0, activeRow * rowH - H * 0.08);
    this._scrollY += (targetY - this._scrollY) * 0.07;

    // Fundo (branco/creme para partitura)
    ctx.fillStyle = "#f2f3f5";
    ctx.fillRect(0, 0, W, H);

    // Linhas visíveis no viewport
    const firstRow = Math.max(0, Math.floor((this._scrollY - topPad) / rowH));
    const lastRow = Math.min(totalRows - 1, firstRow + Math.ceil(H / rowH) + 1);

    for (let row = firstRow; row <= lastRow; row++) {
      const rowTop = topPad + row * rowH - this._scrollY;
      if (rowTop > H + staffH + ls * 4) continue;
      if (rowTop + staffH < -ls * 5) continue;
      this._drawRow(ctx, L, row, rowTop, currentBeat, activeRow);
    }

    // Indicador de metrônomo
    this._drawMetronomeIndicator(ctx, W, H);

    // Partículas
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

  // ── Renderiza uma linha da partitura ──────────────────────────────
  _drawRow(ctx, L, row, rowTop, currentBeat, activeRow) {
    const { W, ls, clefW, measPerRow, measureW, staffH } = L;
    const { numMeasures, beatsPerMeasure } = this._scoreData;

    const firstMeasure = row * measPerRow;
    const lastMeasure = Math.min(
      numMeasures - 1,
      firstMeasure + measPerRow - 1,
    );
    const bot = rowTop + staffH;

    // Faixa branca da área da pauta — margem extra para que hastes de grupos
    // agrupados que se estendam acima/abaixo não invadam o fundo cinza.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, rowTop - ls * 4.5, W, staffH + ls * 9.0);

    // 5 linhas da pauta (do início da área de clave ao fim da linha)
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      ctx.strokeStyle = "#999";
      ctx.beginPath();
      ctx.moveTo(clefW - 2, rowTop + i * ls);
      ctx.lineTo(W, rowTop + i * ls);
      ctx.stroke();
    }

    // Barra de compasso inicial
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(clefW - 2, rowTop);
    ctx.lineTo(clefW - 2, bot);
    ctx.stroke();

    // Clave de sol
    ctx.fillStyle = "#222";
    ctx.font = `${ls * 7}px 'Times New Roman', Georgia, serif`;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillText("\uD834\uDD1E", 2, bot + ls * 0.65);

    // Fórmula de compasso 4/4
    const tsX = ls * 5.9;
    ctx.fillStyle = "#222";
    ctx.font = `bold ${ls * 1.9}px 'Times New Roman', Georgia, serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("4", tsX, rowTop + ls * 1.0);
    ctx.fillText("4", tsX, rowTop + ls * 3.0);

    // Barras de compasso e números
    for (let m = firstMeasure; m <= lastMeasure; m++) {
      const mOff = m - firstMeasure;
      const bx = clefW + (mOff + 1) * measureW;

      const isLastMeasure = m === numMeasures - 1;
      if (isLastMeasure) {
        // Barra dupla final: fina + grossa, espaçadas em ~0,4 espaços
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
        // Barra normal — ligeiramente mais clara que a barra inicial
        // para que notas e ligaduras sejam lidas antes da estrutura de compasso.
        ctx.strokeStyle = "#aaa";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(bx, rowTop);
        ctx.lineTo(bx, bot);
        ctx.stroke();
      }

      // Número do compasso — rótulo pequeno e sutil acima da barra
      ctx.fillStyle = "#bbb";
      ctx.font = `${ls * 0.65}px sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(m + 1, clefW + mOff * measureW + 3, rowTop - ls * 0.5);
    }

    // Pausas
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

    // Coletar grupos de ligadura desta linha
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

    // Notas
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

    // Ligaduras de colcheia
    for (const [, groupNotes] of beamGroupsMap) {
      this._drawBeam(ctx, L, groupNotes, firstMeasure, rowTop);
    }

    // Cursor de posição atual
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

  // ── Desenho da nota (cabeça, haste, acidentes, ponto de aumento) ─────
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
    // Última rede de segurança: arredonda durationBeats caso tenha sido
    // definido externamente (ex.: importação ao vivo) sem passar por _buildScore.
    const dur = snapToMusical(note.durationBeats ?? 1);
    const step = diatonicStep(writtenNote);
    const stemUp = step < 6;

    const color =
      note.state === "hit"
        ? "#15803d"
        : note.state === "miss"
          ? "#b91c1c"
          : "#1a1a2e";

    // ── Classificação do tipo de nota ──────────────────────────────
    // Detecta valores pontuados primeiro; depois extrai a duração base.
    // Com valores arredondados as tolerâncias são generosas de propósito —
    // tornam o renderizador resistente mesmo se o caller pular o snap.
    const hasDot =
      Math.abs(dur - 3.0) < 0.13 || // mínima pontuada      (2  × 1,5)
      Math.abs(dur - 1.5) < 0.13 || // semínima pontuada    (1  × 1,5)
      Math.abs(dur - 0.75) < 0.08 || // colcheia pontuada    (0,5 × 1,5)
      Math.abs(dur - 0.375) < 0.05 || // semicolcheia pontuada(0,25 × 1,5)
      Math.abs(dur - 0.1875) < 0.03 || // fusa pontuada        (0,125 × 1,5)
      Math.abs(dur - 0.09375) < 0.02; // semifusa pontuada    (0,0625 × 1,5)

    // baseDur é o equivalente sem ponto (2, 1 ou 0,5 respectivamente)
    const baseDur = hasDot ? dur / 1.5 : dur;

    const isWhole = baseDur >= 4.0 - 0.13;
    const isHalf = !isWhole && baseDur >= 2.0 - 0.13;
    // isQuarter: tudo entre mínima e colcheia
    const isQuarter = !isWhole && !isHalf && baseDur >= 1.0 - 0.13;
    const isEighth = !isWhole && !isHalf && !isQuarter && baseDur >= 0.5 - 0.13;
    const isSixteenth =
      !isWhole && !isHalf && !isQuarter && !isEighth && baseDur >= 0.25 - 0.06; // semicolcheia
    const isFusa =
      !isWhole &&
      !isHalf &&
      !isQuarter &&
      !isEighth &&
      !isSixteenth &&
      baseDur >= 0.125 - 0.04; // fusa
    const isSemifusa =
      !isWhole && !isHalf && !isQuarter && !isEighth && !isSixteenth && !isFusa; // semifusa
    // Cabeças abertas para semibreve e mínima (incluindo mínima pontuada)
    const isFilled = !isWhole && !isHalf;

    const rx = isWhole ? ls * 0.58 : ls * 0.5;
    const ry = isWhole ? ls * 0.36 : ls * 0.32;

    // Linhas suplementares
    this._drawLedgerLines(ctx, step, x, staffTopY, ls, rx, color);

    // Cabeça da nota
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
      // Cabeça aberta: fundo branco primeiro (cobre linhas da pauta), depois contorno
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = ls * 0.13;
      ctx.stroke();
    }
    ctx.restore();

    // Acidente — centralizado verticalmente na cabeça da nota (sem deslocamento)
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

    // Ponto de aumento — colocado no espaço à direita da cabeça.
    // Se a nota cai numa linha da pauta (passo diatônico par) sobe o ponto
    // um passo diatônico (ls * 0,5) para o espaço acima.
    if (hasDot) {
      const dotY = step % 2 === 0 ? y - ls * 0.5 : y;
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + rx + ls * 0.55, dotY, ls * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Haste + bandeiras — ignoradas para semibreves e notas agrupadas
    // (notas agrupadas recebem suas hastes pelo método _drawBeam)
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

      const flags = isSemifusa
        ? 4
        : isFusa
          ? 3
          : isSixteenth
            ? 2
            : isEighth
              ? 1
              : 0;
      if (flags > 0)
        this._drawFlags(ctx, stemX, stemEndY, stemUp, flags, ls, color);
    }
  }

  // ── Renderização de bandeiras (flags) ──────────────────────────
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
  // Regras de gravura implementadas aqui:
  //  • Direção da ligadura decidida por voto majoritário das notas.
  //  • Inclinação segue 30% do contorno melódico entre a primeira e a última
  //    nota, limitada a ±0,4 espaços para que o ângulo permaneça legível.
  //  • O ponto de ancoragem Y é definido para que a primeira nota tenha
  //    comprimento de haste preferencial (3,5 espaços); cada nota é verificada
  //    e a ligadura é afastada até nenhuma haste ficar menor que 2,8 espaços.
  //  • Hastes desenhadas individualmente até o Y exato da ligadura.
  //  • A ligadura é um paralelogramo preenchido (não um retângulo plano)
  //    para que a inclinação seja visível.
  //  • Uma segunda ligadura paralela é desenhada para pares de semicolcheias.
  _drawBeam(ctx, L, groupNotes, firstMeasure, rowTop) {
    if (groupNotes.length < 2) return;

    const { ls, clefW, measureW } = L;
    const { beatsPerMeasure } = this._scoreData;

    const rx = ls * 0.5;
    const ry = ls * 0.32;
    const BEAM_H = ls * 0.42; // espessura da barra
    const BEAM_G = ls * 0.26; // espaço entre barra primária e secundária
    const PREF = ls * 3.5; // comprimento de haste preferencial (cabeça → borda externa)
    const MIN = ls * 2.8; // comprimento mínimo de haste

    const sorted = [...groupNotes].sort((a, b) => a.beatStart - b.beatStart);

    // ── Dados por nota ─────────────────────────────────────────────
    const nd = sorted.map((note) => {
      const wn = this._writtenName(note.note);
      const step = diatonicStep(wn);
      const mOff = note.measureIndex - firstMeasure;
      const x = this._noteX(
        note.beatInMeasure,
        beatsPerMeasure,
        clefW + mOff * measureW,
        measureW,
      );
      const y = staffNoteY(wn, rowTop, ls);
      return { x, y, step, note };
    });

    // ── Direção da ligadura: voto majoritário ──────────────────────
    const beamUp = nd.filter((n) => n.step < 6).length >= nd.length / 2;

    // X de ancoragem da haste: direito para haste acima, esquerdo para abaixo
    const stemXof = (n) => (beamUp ? n.x + rx * 0.82 : n.x - rx * 0.82);

    const x0 = stemXof(nd[0]);
    const xN = stemXof(nd[nd.length - 1]);
    const xSpan = xN - x0 || 1;

    // ── Inclinação da ligadura ──────────────────────────────────────
    // Segue 30% do intervalo melódico entre a primeira e a última nota,
    // limitado para que a subida/descida total do grupo ≤ 0,4 espaços.
    const melodicDelta = nd[nd.length - 1].y - nd[0].y; // positivo = melodia desce
    const rawDelta = melodicDelta * 0.3;
    const beamDelta = Math.max(-ls * 0.4, Math.min(ls * 0.4, rawDelta));
    const slope = beamDelta / xSpan;

    // Y de ancoragem no X de cada haste (borda externa)
    // Inicializa pela primeira nota com comprimento preferencial, depois ajusta.
    let b0 = beamUp ? nd[0].y - PREF : nd[0].y + PREF;

    // Passo único: nota mais restritiva desloca b0 conforme.
    // beamUp:   b0 + slope*(sx-x0) ≤ n.y - MIN  → reduz b0.
    // beamDown: b0 + slope*(sx-x0) ≥ n.y + MIN  → aumenta b0.
    for (const n of nd) {
      const sx = stemXof(n);
      const a = slope * (sx - x0); // contribuição da inclinação neste x
      if (beamUp) b0 = Math.min(b0, n.y - MIN - a);
      else b0 = Math.max(b0, n.y + MIN - a);
    }

    // Y de ancoragem após ajuste de b0
    const anchorY = (x) => b0 + slope * (x - x0);

    // ── Cores ──────────────────────────────────────────────────────
    const stateColor = (n) =>
      n.note.state === "hit"
        ? "#15803d"
        : n.note.state === "miss"
          ? "#b91c1c"
          : "#1a1a2e";
    const allHit = sorted.every((n) => n.state === "hit");
    const allMiss = sorted.every((n) => n.state === "miss");
    const beamClr = allHit ? "#15803d" : allMiss ? "#b91c1c" : "#1a1a2e";

    // ── Hastes ─────────────────────────────────────────────────────
    // Cada haste vai da borda da cabeça até a borda externa da ligadura.
    // O paralelogramo preenche BEAM_H em direção às cabeças de nota.
    ctx.lineWidth = ls * 0.11;
    ctx.lineCap = "butt";
    for (const n of nd) {
      const sx = stemXof(n);
      const tip = anchorY(sx); // borda externa da ligadura nesta haste
      ctx.save();
      ctx.strokeStyle = stateColor(n);
      ctx.beginPath();
      ctx.moveTo(sx, n.y + (beamUp ? -ry * 0.4 : ry * 0.4));
      ctx.lineTo(sx, tip);
      ctx.stroke();
      ctx.restore();
    }

    // ── Helper: desenhar paralelogramo da ligadura ──────────────────
    // Desenha uma barra inclinada preenchida do stemX xa ao stemX xb.
    // yOffset desloca a barra perpendicularmente ao eixo (para segunda barra).
    const fillBeam = (xa, xb, yOffset) => {
      const ya = anchorY(xa) + yOffset;
      const yb = anchorY(xb) + yOffset;
      const h = beamUp ? BEAM_H : -BEAM_H; // thickness toward noteheads
      ctx.beginPath();
      ctx.moveTo(xa, ya);
      ctx.lineTo(xb, yb);
      ctx.lineTo(xb, yb + h);
      ctx.lineTo(xa, ya + h);
      ctx.closePath();
      ctx.fill();
    };

    ctx.fillStyle = beamClr;

    // Ligadura primária do primeiro ao último stem do grupo
    fillBeam(x0, xN, 0);

    // Ligadura secundária para pares de semicolcheias (≤ 0,26 tempos)
    const off2 = beamUp ? -(BEAM_H + BEAM_G) : BEAM_H + BEAM_G;
    for (let i = 0; i < nd.length - 1; i++) {
      if (
        nd[i].note.durationBeats <= 0.26 &&
        nd[i + 1].note.durationBeats <= 0.26
      ) {
        fillBeam(stemXof(nd[i]), stemXof(nd[i + 1]), off2);
      }
    }

    // Ligadura terciária para pares de fusas (≤ 0,13 tempos)
    const off3 = beamUp ? -(2 * (BEAM_H + BEAM_G)) : 2 * (BEAM_H + BEAM_G);
    for (let i = 0; i < nd.length - 1; i++) {
      if (
        nd[i].note.durationBeats <= 0.13 &&
        nd[i + 1].note.durationBeats <= 0.13
      ) {
        fillBeam(stemXof(nd[i]), stemXof(nd[i + 1]), off3);
      }
    }

    // Ligadura quaternária para pares de semifusas (≤ 0,07 tempos)
    const off4 = beamUp ? -(3 * (BEAM_H + BEAM_G)) : 3 * (BEAM_H + BEAM_G);
    for (let i = 0; i < nd.length - 1; i++) {
      if (
        nd[i].note.durationBeats <= 0.07 &&
        nd[i + 1].note.durationBeats <= 0.07
      ) {
        fillBeam(stemXof(nd[i]), stemXof(nd[i + 1]), off4);
      }
    }
  }

  // ── Símbolos de pausa ──────────────────────────────────────────
  _drawRest(ctx, durRaw, x, staffTopY, ls) {
    // Arredonda a duração para que _drawRest seja robusto mesmo quando chamado
    // antes que o snap tenha propagado (ex.: no primeiro frame de renderização).
    const dur = snapToMusical(durRaw);

    // Detecta pausas pontuadas em todas as figuras
    const isDotted =
      Math.abs(dur - 3.0) < 0.13 || // mínima pontuada
      Math.abs(dur - 1.5) < 0.13 || // semínima pontuada
      Math.abs(dur - 0.75) < 0.08 || // colcheia pontuada
      Math.abs(dur - 0.375) < 0.05 || // semicolcheia pontuada
      Math.abs(dur - 0.1875) < 0.03 || // fusa pontuada
      Math.abs(dur - 0.09375) < 0.02; // semifusa pontuada
    const baseDur = isDotted ? dur / 1.5 : dur;

    ctx.save();
    ctx.fillStyle = "#555";
    ctx.strokeStyle = "#555";

    if (baseDur >= 4 - 0.13) {
      // Pausa de semibreve: retângulo preenchido abaixo da linha D5 (índice 1 do topo)
      ctx.fillRect(
        x - ls * 0.55,
        staffTopY + ls - ls * 0.42,
        ls * 1.1,
        ls * 0.42,
      );
    } else if (baseDur >= 2 - 0.13) {
      // Pausa de mínima: retângulo preenchido sobre a linha B4 (índice 2 do topo)
      ctx.fillRect(x - ls * 0.55, staffTopY + ls * 2, ls * 1.1, ls * 0.42);
    } else if (baseDur >= 1 - 0.13) {
      this._drawQuarterRest(ctx, x, staffTopY + ls * 2, ls);
    } else if (baseDur >= 0.5 - 0.13) {
      // Pausa de colcheia
      this._drawEighthRest(ctx, x, staffTopY + ls * 2, ls);
    } else if (baseDur >= 0.25 - 0.06) {
      // Pausa de semicolcheia: dois símbolos de colcheia escalonados
      this._drawEighthRest(ctx, x, staffTopY + ls * 1.5, ls);
      this._drawEighthRest(ctx, x + ls * 0.3, staffTopY + ls * 2.5, ls);
    } else if (baseDur >= 0.125 - 0.04) {
      // Pausa de fusa: três símbolos de colcheia escalonados
      this._drawEighthRest(ctx, x, staffTopY + ls * 1.0, ls);
      this._drawEighthRest(ctx, x + ls * 0.3, staffTopY + ls * 2.0, ls);
      this._drawEighthRest(ctx, x, staffTopY + ls * 3.0, ls);
    } else {
      // Pausa de semifusa: quatro símbolos de colcheia escalonados
      this._drawEighthRest(ctx, x, staffTopY + ls * 0.5, ls);
      this._drawEighthRest(ctx, x + ls * 0.3, staffTopY + ls * 1.5, ls);
      this._drawEighthRest(ctx, x, staffTopY + ls * 2.5, ls);
      this._drawEighthRest(ctx, x + ls * 0.3, staffTopY + ls * 3.0, ls);
    }

    // Ponto de aumento para pausas pontuadas — colocado no terceiro espaço de baixo
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

  // ── Cursor de posição atual ────────────────────────────────────
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

  // ── Linhas suplementares ───────────────────────────────────────
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

  // ── Indicador de metrônomo ─────────────────────────────────────
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
