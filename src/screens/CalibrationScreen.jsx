import { useEffect, useRef, useState } from 'react'
import PitchDetector from '../lib/PitchDetector.js'

export default function CalibrationScreen({
  navigate,
  selectedSong,
  saxType,
}) {
  const [micStatus, setMicStatus] = useState('Conectando ao microfone...')
  const [ready, setReady]         = useState(false)
  const [tunerNote, setTunerNote] = useState('—')
  const [tunerFreq, setTunerFreq] = useState('0 Hz')
  const [needlePct, setNeedlePct] = useState(50)
  const [needleColor, setNeedleColor] = useState('var(--accent2)')
  const [hint, setHint]           = useState('Toque qualquer nota para calibrar')

  const detectorRef = useRef(null)

  // Helper de transposição (nota escrita a partir da nota de concerto)
  const SAX_TRANSPOSITIONS = { alto: 9, tenor: 2, soprano: 2 }
  const _NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
  const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']

  const midiToNoteName = (midi) =>
    _NOTES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1)

  const noteNameToMidi = (name) => {
    const m = name.match(/^([A-G]#?)(\d)$/)
    if (!m) return 0
    const idx = NOTE_NAMES.indexOf(m[1])
    return (parseInt(m[2]) + 1) * 12 + idx
  }

  const writtenName = (concertNote) => {
    const offset = SAX_TRANSPOSITIONS[saxType] ?? 0
    if (offset === 0) return concertNote
    return midiToNoteName(noteNameToMidi(concertNote) + offset)
  }

  useEffect(() => {
    let detector = new PitchDetector()
    detectorRef.current = detector

    const init = async () => {
      const ok = await detector.init()
      if (!ok) {
        setMicStatus('Não foi possível acessar o microfone. Verifique as permissões.')
        return
      }
      setMicStatus('Microfone conectado! Toque uma nota para testar.')
      setReady(true)

      detector.onPitch = (freq, note) => {
        const wn = writtenName(note.name)
        setTunerNote(wn)
        setTunerFreq(`${freq.toFixed(1)} Hz  (concerto: ${note.name})`)
        const pct = 50 + (note.cents / 100) * 46
        setNeedlePct(Math.max(2, Math.min(98, pct)))
        const color = Math.abs(note.cents) < 15 ? '#22c55e' : '#f97316'
        setNeedleColor(color)
        setHint(
          Math.abs(note.cents) < 15 ? 'Afinado!' :
          note.cents > 0 ? 'Abaixe um pouco' : 'Suba um pouco'
        )
      }
      detector.onSilence = () => {
        setHint('Toque qualquer nota para calibrar')
      }

      detector.start()
    }
    init()

    return () => {
      detector.stop()
    }
  }, [saxType])

  const handlePlay = () => {
    if (!ready) return
    navigate('game')
  }

  const handleBack = () => {
    detectorRef.current?.stop()
    navigate('menu')
  }

  return (
    <div className="screen active" id="screen-calibration">
      <div className="calibration-container">
        <h2>Teste do Microfone</h2>
        <p id="mic-status-text">{micStatus}</p>

        <div className="tuner-display">
          <div className="tuner-note">{tunerNote}</div>
          <div className="tuner-freq">{tunerFreq}</div>
          <div className="tuner-bar-wrap">
            <div className="tuner-mark">−50¢</div>
            <div className="tuner-track">
              <div
                className="tuner-needle"
                style={{ left: needlePct + '%', background: needleColor, boxShadow: `0 0 10px ${needleColor}` }}
              />
              <div className="tuner-center" />
            </div>
            <div className="tuner-mark">+50¢</div>
          </div>
          <div className="tuner-hint">{hint}</div>
        </div>

        <div className="calibration-buttons">
          <button className="btn-secondary" onClick={handleBack}>← Voltar</button>
          <button className="btn-primary" disabled={!ready} onClick={handlePlay}>
            Tocar!
          </button>
        </div>
      </div>
    </div>
  )
}
