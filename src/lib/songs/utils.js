/**
 * Converte um array de notas em formato de beats para segundos.
 * Formato de entrada: [noteName, startBeat, durationInBeats]
 * Todas as músicas usam tom de concerto (o que o microfone capta).
 *
 * @param {Array} arr  - Array de notas [[nota, beat, duração], ...]
 * @param {number} bpm - Andamento em beats por minuto
 * @returns {Array} Notas com campos: note, time, duration, beatStart, durationBeats
 */
export function beats(arr, bpm) {
  const spb = 60 / bpm;
  const minBeat = arr.length ? Math.min(...arr.map(([, b]) => b)) : 0;
  return arr.map(([note, beat, dur]) => ({
    note,
    time: beat * spb,
    duration: dur * spb,
    beatStart: beat - minBeat,
    durationBeats: dur,
  }));
}
