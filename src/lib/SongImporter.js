/**
 * SongImporter — Analyzes audio files and extracts melody notes.
 * Uses essentia.js PitchMelodia when available, falls back to ACF2+.
 */

// MIDI range for saxophone (all types)
const SAX_MIDI_MIN = 52;  // E3 = 164 Hz
const SAX_MIDI_MAX = 84;  // C6 = 1047 Hz
const SAX_MIDI_MIN_HZ = 164;  // E3
const SAX_MIDI_MAX_HZ = 1047; // C6

let essentiaInstance = null;

async function getEssentia() {
  if (essentiaInstance) return essentiaInstance;
  try {
    const { default: EssentiaModule } = await import('essentia.js');
    // essentia.js may expose EssentiaWASM differently depending on version
    let wasmFactory;
    try {
      const wasmMod = await import('essentia.js/dist/essentia-wasm.umd.js');
      wasmFactory = wasmMod.EssentiaWASM;
    } catch (_) {
      wasmFactory = EssentiaModule.EssentiaWASM;
    }
    const wasm = await wasmFactory();
    essentiaInstance = new EssentiaModule(wasm);
    return essentiaInstance;
  } catch (e) {
    console.warn('[SongImporter] essentia.js unavailable, using ACF2+ fallback:', e);
    return null;
  }
}

export class SongImporter {
  constructor() {
    this.onProgress      = null; // callback(pct, msg)
    this.onComplete      = null; // callback(songObject)
    this.onError         = null; // callback(errMsg)
    this.lastAudioBuffer = null;
  }

  // ── Entry point ───────────────────────────────────────────────
  async analyzeFile(file, title, bpm) {
    this.lastAudioBuffer = null;
    try {
      this._report(0, 'Decodificando áudio…');
      const ac       = new AudioContext();
      const arrayBuf = await file.arrayBuffer();
      const rawBuf   = await ac.decodeAudioData(arrayBuf);
      await ac.close();

      this.lastAudioBuffer = rawBuf;
      this._report(8, `Áudio: ${rawBuf.duration.toFixed(1)}s · ${rawBuf.sampleRate} Hz`);

      // 1. Bandpass filter (removes drums, bass, noise)
      this._report(12, 'Aplicando filtro de frequências…');
      const filtered = await this._bandpass(rawBuf);
      const samples  = this._toMono(filtered);
      const sr       = filtered.sampleRate;

      // 2. Try essentia.js first, then ACF2+
      let frames = null;
      frames = await this._extractWithEssentia(samples, sr, (pct, msg) => this._report(pct, msg));
      if (!frames) {
        this._report(18, 'Detectando alturas (ACF2+)…');
        frames = await this._extractWithACF2(samples, sr);
      }

      // 3. Median filter to smooth vibrato
      this._report(72, 'Suavizando pitch…');
      this._medianSmooth(frames, 7);

      // 4. Segment into notes
      this._report(78, 'Extraindo notas…');
      const rawNotes = this._segmentNotes(frames);

      if (rawNotes.length === 0) {
        this.onError?.('Nenhuma nota encontrada. Dica: use uma gravação limpa da melodia, sem bateria ou acordes.');
        return;
      }

      // 5. BPM
      let finalBpm = (bpm && bpm > 0) ? bpm : null;
      if (!finalBpm) {
        this._report(84, 'Detectando BPM…');
        finalBpm = this._detectBpm(rawNotes) ?? 100;
      }
      this._report(88, `BPM: ${finalBpm}`);

      // 6. Quantize
      this._report(92, 'Ajustando ao grid…');
      const notes = this._quantize(rawNotes, finalBpm);

      this._report(100, `${notes.length} notas · ${finalBpm} BPM`);

      this.onComplete?.({
        id:         'import_' + Date.now(),
        title:      title?.trim() || 'Música importada',
        author:     'Importada',
        difficulty: 2,
        bpm:        finalBpm,
        notes,
        imported:   true,
      });

    } catch (err) {
      console.error('[SongImporter]', err);
      this.onError?.('Erro ao analisar: ' + err.message);
    }
  }

  // ── Essentia.js extraction ────────────────────────────────────
  async _extractWithEssentia(monoSamples, sr, onProgress) {
    const essentia = await getEssentia();
    if (!essentia) return null;

    try {
      onProgress(20, 'Carregando motor de análise (essentia.js)…');
      const signal = essentia.arrayToVector(monoSamples);

      onProgress(30, 'Extraindo melodia (PitchMelodia)…');
      const melodyResult = essentia.PitchMelodia(
        signal,
        4096,           // frameSize
        256,            // hopSize
        0,              // binResolution
        SAX_MIDI_MAX_HZ,// maxFrequency
        SAX_MIDI_MIN_HZ,// minFrequency
        0.9,            // guessUnvoiced
        0,              // harmonicWeight
        false,          // magnitudeCompression
        false,          // magnitudeThreshold
        40,             // numberHarmonics
        0.9,            // peakDistributionThreshold
        10,             // peakFrameThreshold
        100,            // pitchContinuity
        sr              // sampleRate
      );

      const pitches     = essentia.vectorToArray(melodyResult.pitch);
      const confidences = essentia.vectorToArray(melodyResult.pitchConfidence);

      const hop = 256;
      const frames = pitches.map((freq, i) => {
        const time = (i * hop) / sr;
        const conf = confidences[i];
        let midi = -1;
        if (freq > 0 && conf > 0.1) {
          const raw = Math.round(69 + 12 * Math.log2(freq / 440));
          if (raw >= SAX_MIDI_MIN && raw <= SAX_MIDI_MAX) midi = raw;
        }
        return { time, freq, midi, conf };
      });

      onProgress(70, `${frames.filter(f => f.midi >= 0).length} frames com pitch detectado`);
      return frames;
    } catch (e) {
      console.warn('[SongImporter] PitchMelodia error:', e);
      return null;
    }
  }

  // ── ACF2+ fallback extraction ─────────────────────────────────
  async _extractWithACF2(samples, sr) {
    const FRAME = 2048;
    const HOP   = 256;
    const total = Math.floor((samples.length - FRAME) / HOP);
    const frames = [];

    for (let i = 0; i * HOP + FRAME < samples.length; i++) {
      if (i % 600 === 0) {
        this._report(18 + Math.round(i / total * 52), `Analisando… ${Math.round(i / total * 100)}%`);
        await new Promise(r => setTimeout(r, 0));
      }

      const frame = samples.slice(i * HOP, i * HOP + FRAME);
      const { freq, confidence } = autoCorrelateConfident(frame, sr);
      const time = (i * HOP) / sr;

      let midi = -1;
      if (freq > 0 && confidence > 0.88) {
        const raw = Math.round(69 + 12 * Math.log2(freq / 440));
        if (raw >= SAX_MIDI_MIN && raw <= SAX_MIDI_MAX) midi = raw;
      }

      frames.push({ time, freq, midi, conf: confidence });
    }
    return frames;
  }

  // ── Bandpass filter via OfflineAudioContext ──────────────────
  async _bandpass(audioBuf) {
    const off = new OfflineAudioContext(1, audioBuf.length, audioBuf.sampleRate);
    const src = off.createBufferSource();
    src.buffer = audioBuf;

    // Cascade of 2 HPFs at 175 Hz → 4th-order rolloff (~24 dB/octave)
    const hpf1 = off.createBiquadFilter();
    hpf1.type = 'highpass';
    hpf1.frequency.value = 175;
    hpf1.Q.value = 0.7;

    const hpf2 = off.createBiquadFilter();
    hpf2.type = 'highpass';
    hpf2.frequency.value = 175;
    hpf2.Q.value = 0.7;

    const lpf = off.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = 1050;
    lpf.Q.value = 0.7;

    src.connect(hpf1);
    hpf1.connect(hpf2);
    hpf2.connect(lpf);
    lpf.connect(off.destination);
    src.start(0);
    return off.startRendering();
  }

  // ── Mix to mono ───────────────────────────────────────────────
  _toMono(audioBuf) {
    if (audioBuf.numberOfChannels === 1) return audioBuf.getChannelData(0);
    const L = audioBuf.getChannelData(0);
    const R = audioBuf.getChannelData(1);
    const m = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) m[i] = (L[i] + R[i]) * 0.5;
    return m;
  }

  // ── Median filter on MIDI track ───────────────────────────────
  _medianSmooth(frames, win) {
    const half = Math.floor(win / 2);
    const orig  = frames.map(f => f.midi);
    for (let i = 0; i < frames.length; i++) {
      const slice = orig
        .slice(Math.max(0, i - half), Math.min(frames.length, i + half + 1))
        .filter(m => m >= 0);
      if (slice.length === 0) { frames[i].midi = -1; continue; }
      const sorted = [...slice].sort((a, b) => a - b);
      frames[i].midi = sorted[Math.floor(sorted.length / 2)];
    }
  }

  // ── Note segmentation with hysteresis ─────────────────────────
  _segmentNotes(frames) {
    const MIN_FRAMES = 5;
    const PITCH_TOL  = 1.3;
    const GAP_TOL    = 4;
    const notes = [];

    let segStart  = -1;
    let segMidis  = [];
    let gapCount  = 0;
    let lastSound = 0;

    const flush = (endTime) => {
      if (segMidis.length >= MIN_FRAMES) {
        notes.push({
          note:     this._midiToName(this._mode(segMidis)),
          time:     segStart,
          duration: Math.max(0.08, endTime - segStart),
        });
      }
      segStart = -1;
      segMidis = [];
      gapCount = 0;
    };

    for (const f of frames) {
      if (f.midi < 0) {
        gapCount++;
        if (gapCount >= GAP_TOL && segStart >= 0) flush(lastSound);
        continue;
      }

      lastSound = f.time;
      gapCount  = 0;

      if (segStart < 0) {
        segStart = f.time;
        segMidis = [f.midi];
      } else {
        const mode = this._mode(segMidis);
        if (Math.abs(f.midi - mode) > PITCH_TOL) {
          flush(f.time);
          segStart = f.time;
          segMidis = [f.midi];
        } else {
          segMidis.push(f.midi);
        }
      }
    }
    if (segStart >= 0) flush(lastSound);

    return notes;
  }

  // ── Quantize to BPM grid ──────────────────────────────────────
  _quantize(notes, bpm) {
    if (!notes.length) return notes;
    const beat   = 60 / bpm;
    const subdiv = beat / 4;
    const result = [];

    for (const n of notes) {
      const qt = Math.round(n.time / subdiv) * subdiv;
      const qd = Math.max(subdiv, Math.round(n.duration / subdiv) * subdiv);
      const last = result[result.length - 1];
      if (last && Math.abs(qt - last.time) < subdiv * 0.5) continue;
      result.push({ note: n.note, time: qt, duration: qd });
    }
    return result;
  }

  // ── BPM detection via IOI ─────────────────────────────────────
  _detectBpm(notes) {
    if (notes.length < 4) return null;
    const iois = [];
    for (let i = 1; i < notes.length; i++) {
      const d = notes[i].time - notes[i - 1].time;
      if (d >= 0.15 && d <= 2.5) iois.push(d);
    }
    if (!iois.length) return null;

    const scores = {};
    for (const ioi of iois) {
      for (const mult of [1, 0.5, 2, 0.25, 4]) {
        const d = ioi * mult;
        if (d < 0.18 || d > 2.2) continue;
        const bpm = Math.round(60 / d);
        const bin = Math.round(bpm / 4) * 4;
        scores[bin] = (scores[bin] ?? 0) + 1 / (1 + Math.abs(Math.log2(mult)));
      }
    }

    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) return null;

    let bpmRaw = parseInt(sorted[0][0]);
    if (bpmRaw > 140 && bpmRaw <= 280) {
      const half    = Math.round(bpmRaw / 2 / 4) * 4;
      const halfScr = scores[half] ?? 0;
      const fullScr = parseFloat(sorted[0][1]);
      if (halfScr >= fullScr * 0.4) bpmRaw = half;
    }
    return Math.max(40, Math.min(220, bpmRaw));
  }

  // ── Utilities ─────────────────────────────────────────────────
  _mode(arr) {
    const c = {};
    for (const v of arr) c[v] = (c[v] ?? 0) + 1;
    return parseInt(Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]);
  }

  _midiToName(midi) {
    const N = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    return N[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
  }

  _report(pct, status) {
    this.onProgress?.(Math.min(100, pct), status);
  }
}

// ── ACF2+ with confidence return ─────────────────────────────────
function autoCorrelateConfident(buf, sampleRate) {
  const SIZE = buf.length;

  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.006) return { freq: -1, confidence: 0 };

  let r1 = 0, r2 = SIZE - 1;
  const THRES = 0.2;
  for (let i = 0; i < SIZE / 2; i++) { if (Math.abs(buf[i]) < THRES) { r1 = i; break; } }
  for (let i = 1; i < SIZE / 2; i++) { if (Math.abs(buf[SIZE - i]) < THRES) { r2 = SIZE - i; break; } }

  const trim = buf.slice(r1, r2);
  const len  = trim.length;
  if (len < 128) return { freq: -1, confidence: 0 };

  const c = new Array(len).fill(0);
  for (let i = 0; i < len; i++)
    for (let j = 0; j < len - i; j++)
      c[i] += trim[j] * trim[j + i];

  let d = 0;
  while (d < len - 1 && c[d] > c[d + 1]) d++;

  let maxVal = -1, maxPos = -1;
  for (let i = d; i < len; i++) {
    if (c[i] > maxVal) { maxVal = c[i]; maxPos = i; }
  }
  if (maxPos < 1 || maxPos >= len - 1) return { freq: -1, confidence: 0 };

  const confidence = c[0] > 0 ? maxVal / c[0] : 0;

  const x1 = c[maxPos - 1], x2 = c[maxPos], x3 = c[maxPos + 1];
  const a  = (x1 + x3 - 2 * x2) / 2;
  const b  = (x3 - x1) / 2;
  const T0 = a ? (maxPos - b / (2 * a)) : maxPos;

  const freq = sampleRate / T0;
  if (freq < 155 || freq > 1100) return { freq: -1, confidence: 0 };

  return { freq, confidence };
}
