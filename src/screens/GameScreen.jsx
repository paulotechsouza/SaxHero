import { useEffect, useRef, useState, useCallback } from 'react'
import PitchDetector from '../lib/PitchDetector.js'
import Metronome from '../lib/Metronome.js'
import { GameEngine, SAX_LABELS } from '../lib/GameEngine.js'

export default function GameScreen({
  navigate,
  selectedSong,
  saxType,
  difficulty,
  speedMult,
  audioBuffers,
  onEnd,
}) {
  const canvasRef = useRef(null)
  const engineRef = useRef(null)
  const detectorRef = useRef(null)
  const metronomeRef = useRef(null)

  const [score, setScore]           = useState(0)
  const [combo, setCombo]           = useState(0)
  const [accuracy, setAccuracy]     = useState(100)
  const [detectedNote, setDetected] = useState('—')
  const [progress, setProgress]     = useState(0)
  const [paused, setPaused]         = useState(false)
  const [countdown, setCountdown]   = useState(null) // null | 3 | 2 | 1 | 'GO!'
  const [feedback, setFeedback]     = useState({ text: '', color: '#fff' })
  const [metronomeOn, setMetronomeOn] = useState(true)
  const [bgVolume, setBgVolume]     = useState(0.35)

  // feedback pop animation trigger
  const feedbackKeyRef = useRef(0)

  // ── Initialize engine ──────────────────────────────────────────
  useEffect(() => {
    if (!selectedSong || !canvasRef.current) return

    const detector  = new PitchDetector()
    const metronome = new Metronome()
    detectorRef.current  = detector
    metronomeRef.current = metronome

    const engine = new GameEngine(canvasRef.current, detector, metronome, {
      onScoreUpdate: (s, c, a) => {
        setScore(s)
        setCombo(c)
        setAccuracy(a)
      },
      onFeedback: (text, color) => {
        feedbackKeyRef.current++
        setFeedback({ text, color, key: feedbackKeyRef.current })
      },
      onEnd: (results) => {
        onEnd(results)
      },
      onDetectedNote: (note) => setDetected(note),
      onBeat: () => {},
      onProgress: (pct) => setProgress(pct),
    })

    engineRef.current = engine

    // Transfer pre-loaded audio buffers
    audioBuffers.forEach((buf, id) => engine.storeAudioBuffer(id, buf))

    // Load audioSrc if not yet loaded
    if (selectedSong.audioSrc && !audioBuffers.has(selectedSong.id)) {
      engine.preloadAudioSrc(selectedSong).then(() => {
        audioBuffers.set(selectedSong.id, engine.audioBuffers.get(selectedSong.id))
      })
    }

    engine.setup(selectedSong, difficulty, speedMult, saxType)
    engine.setMetronomeEnabled(metronomeOn)
    engine.setBgVolume(bgVolume)

    // Start detector
    detector.init().then((ok) => {
      if (ok) detector.start()
    })

    // Countdown
    startCountdown(engine)

    return () => {
      engine.stop()
      detector.stop()
      detector.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startCountdown = (engine) => {
    let count = 3
    const tick = () => {
      setCountdown(count > 0 ? count : 'GO!')
      if (count === 0) {
        setTimeout(() => {
          setCountdown(null)
          engine.begin()
        }, 700)
      } else {
        count--
        setTimeout(tick, 900)
      }
    }
    tick()
  }

  const togglePause = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return
    if (!paused) {
      engine.pause()
      setPaused(true)
    } else {
      engine.resume()
      setPaused(false)
    }
  }, [paused])

  const handleBackToMenu = () => {
    engineRef.current?.stop()
    detectorRef.current?.destroy()
    navigate('menu')
  }

  const handleToggleMetronome = () => {
    const next = !metronomeOn
    setMetronomeOn(next)
    engineRef.current?.setMetronomeEnabled(next)
  }

  const handleBgVolume = () => {
    let next
    if (bgVolume === 0)          next = 0.35
    else if (bgVolume < 0.5)    next = 0.70
    else                        next = 0
    setBgVolume(next)
    engineRef.current?.setBgVolume(next)
  }

  const volIcon = bgVolume === 0 ? '🔇' : bgVolume < 0.5 ? '🔉' : '🔊'

  const songLabel = selectedSong
    ? `${selectedSong.title}  ·  ${SAX_LABELS[saxType] ?? saxType}`
    : '—'

  return (
    <div className="screen active" id="screen-game" style={{ flexDirection: 'column' }}>
      {/* HUD */}
      <div className="game-hud">
        <div className="hud-left">
          <div className="hud-song">{songLabel}</div>
        </div>
        <div className="hud-center">
          <div className="hud-stat">
            <div className="hud-val">{score.toLocaleString()}</div>
            <div className="hud-lbl">SCORE</div>
          </div>
          <div className="hud-stat">
            <div className="hud-val">{combo}×</div>
            <div className="hud-lbl">COMBO</div>
          </div>
          <div className="hud-stat">
            <div className="hud-val">{accuracy}%</div>
            <div className="hud-lbl">PRECISÃO</div>
          </div>
        </div>
        <div className="hud-right">
          <div className="hud-detected">
            <span className="hud-lbl">TOCANDO</span>
            <span>{detectedNote}</span>
          </div>
          <button
            className={`btn-icon${metronomeOn ? ' active' : ''}`}
            title={metronomeOn ? 'Metrônomo: ON' : 'Metrônomo: OFF'}
            onClick={handleToggleMetronome}
          >♩</button>
          <button
            className={`btn-icon${bgVolume > 0 ? ' active' : ''}`}
            title={`Música de fundo: ${bgVolume === 0 ? 'MUDO' : bgVolume < 0.5 ? 'BAIXO' : 'ALTO'}`}
            onClick={handleBgVolume}
          >{volIcon}</button>
          <button className="btn-icon" onClick={togglePause}>⏸</button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="progress-bar-wrap">
        <div className="progress-bar" style={{ width: `${progress * 100}%` }} />
      </div>

      {/* Canvas */}
      <canvas ref={canvasRef} id="game-canvas" style={{ flex: 1, display: 'block', width: '100%' }} />

      {/* Feedback overlay */}
      {feedback.text && (
        <div
          key={feedback.key}
          className="feedback-overlay pop"
          style={{ color: feedback.color }}
        >
          {feedback.text}
        </div>
      )}

      {/* Pause overlay */}
      {paused && (
        <div className="pause-overlay">
          <div className="pause-box">
            <h2>⏸ Pausado</h2>
            <button className="btn-primary" onClick={togglePause}>▶ Continuar</button>
            <button className="btn-secondary" onClick={handleBackToMenu}>Menu</button>
          </div>
        </div>
      )}

      {/* Countdown overlay */}
      {countdown !== null && (
        <div className="countdown-overlay">
          <div className="countdown-num" key={countdown}>
            {countdown}
          </div>
        </div>
      )}
    </div>
  )
}
