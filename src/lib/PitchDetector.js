/**
 * PitchDetector — Detecção de pitch via Web Audio API + algoritmo ACF2+
 *
 * O ACF2+ (autocorrelação de segunda ordem) funciona bem para o
 * saxofone pois o instrumento tem fundamental forte e harmônicos regulares.
 * O detector captura amostras do microfone em tempo real e dispara
 * callbacks onPitch e onSilence para que o GameEngine avalie a nota.
 */

export default class PitchDetector {
  constructor() {
    this.audioCtx = null;
    this.analyser = null;
    this.buffer = null;
    this.stream = null;
    this.isRunning = false;
    this.animFrameId = null;

    /** Chamado com (frequência, noteInfo) quando um pitch é detectado */
    this.onPitch = null;
    /** Chamado quando o sinal está muito baixo (silêncio) */
    this.onSilence = null;

    this._lastPitchAt = 0;
  }

  async init() {
    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const source = this.audioCtx.createMediaStreamSource(this.stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 2048;
      source.connect(this.analyser);
      this.buffer = new Float32Array(this.analyser.fftSize);
      return true;
    } catch (e) {
      console.error("[PitchDetector] falha ao inicializar:", e);
      return false;
    }
  }

  start() {
    this.isRunning = true;
    this._loop();
  }

  stop() {
    this.isRunning = false;
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
  }

  destroy() {
    this.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.audioCtx?.close();
  }

  _loop() {
    if (!this.isRunning) return;
    this.animFrameId = requestAnimationFrame(() => this._loop());

    this.analyser.getFloatTimeDomainData(this.buffer);
    const freq = autoCorrelate(this.buffer, this.audioCtx.sampleRate);

    if (freq > 0) {
      this._lastPitchAt = Date.now();
      const note = frequencyToNote(freq);
      this.onPitch?.(freq, note);
    } else if (Date.now() - this._lastPitchAt > 150) {
      this.onSilence?.();
    }
  }
}

/* ----------------------------------------------------------
   Algoritmo de detecção de pitch ACF2+
   (Adaptado de Chris Wilson / web-audio-samples)
   ---------------------------------------------------------- */
function autoCorrelate(buf, sampleRate) {
  const SIZE = buf.length;

  // Verificação RMS — rejeita silêncio
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.008) return -1;

  // Corta bordas de cruzamento de zero para reduzir ruído
  let r1 = 0,
    r2 = SIZE - 1;
  const THRES = 0.2;
  for (let i = 0; i < SIZE / 2; i++) {
    if (Math.abs(buf[i]) < THRES) {
      r1 = i;
      break;
    }
  }
  for (let i = 1; i < SIZE / 2; i++) {
    if (Math.abs(buf[SIZE - i]) < THRES) {
      r2 = SIZE - i;
      break;
    }
  }

  const trimBuf = buf.slice(r1, r2);
  const len = trimBuf.length;

  // Constrói o vetor de autocorrelação
  const c = new Array(len).fill(0);
  for (let i = 0; i < len; i++)
    for (let j = 0; j < len - i; j++) c[i] += trimBuf[j] * trimBuf[j + i];

  // Encontra o primeiro mínimo local (d), depois o pico após ele
  let d = 0;
  while (c[d] > c[d + 1]) d++;

  let maxVal = -1,
    maxPos = -1;
  for (let i = d; i < len; i++) {
    if (c[i] > maxVal) {
      maxVal = c[i];
      maxPos = i;
    }
  }
  if (maxPos < 1 || maxPos >= len - 1) return -1;

  // Interpolação parabólica para precisão sub-amostral
  const x1 = c[maxPos - 1],
    x2 = c[maxPos],
    x3 = c[maxPos + 1];
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  const T0 = a ? maxPos - b / (2 * a) : maxPos;

  const freq = sampleRate / T0;

  // Validação: faixa do saxofone é aproximadamente 100 Hz – 1200 Hz
  if (freq < 100 || freq > 1300) return -1;

  return freq;
}

/* ----------------------------------------------------------
   Frequência → nome da nota + desvio em cents
   ---------------------------------------------------------- */
const NOTE_NAMES = [
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

function frequencyToNote(freq) {
  const A4_MIDI = 69;
  const A4_FREQ = 440;

  const exactMidi = A4_MIDI + 12 * Math.log2(freq / A4_FREQ);
  const roundedMidi = Math.round(exactMidi);
  const cents = Math.round((exactMidi - roundedMidi) * 100);
  const octave = Math.floor(roundedMidi / 12) - 1;
  const noteIdx = ((roundedMidi % 12) + 12) % 12;
  const name = NOTE_NAMES[noteIdx] + octave;

  return { name, midi: roundedMidi, cents, freq };
}

/** Converte um nome de nota (ex.: "D#4", "Bb4", "Fb3") para número MIDI */
export function noteNameToMidi(name) {
  const m = name.match(/^([A-G])(#|b?)(\d)$/);
  if (!m) return 0;
  const baseIdx = NOTE_NAMES.indexOf(m[1]);
  const accident = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  const idx = (baseIdx + accident + 12) % 12;
  // Ajusta oitava quando o bemol faz a nota cruzar para o semitom anterior (ex.: Cb → B anterior)
  const octaveShift = baseIdx + accident < 0 ? -1 : 0;
  return (parseInt(m[3]) + 1 + octaveShift) * 12 + idx;
}
