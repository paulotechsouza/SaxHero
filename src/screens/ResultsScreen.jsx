import { useEffect, useState } from 'react'

const GRADE_COLORS = {
  S: '#ffd700',
  A: '#a78bfa',
  B: '#38bdf8',
  C: '#86efac',
  D: '#f87171',
}

export default function ResultsScreen({
  navigate,
  selectedSong,
  results,
  onRetry,
}) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Slight delay so React can mount and CSS transitions work
    const t = setTimeout(() => setVisible(true), 50)
    return () => clearTimeout(t)
  }, [])

  if (!results) return null

  const { grade, score, accuracy, hits, total, maxCombo } = results
  const gradeColor = GRADE_COLORS[grade] ?? '#fff'

  const handleRetry = () => {
    if (onRetry) onRetry()
    else navigate('game')
  }

  return (
    <div className="screen active" id="screen-results">
      <div className="results-container">
        <h2 style={{ fontSize: '1.2rem', color: 'var(--text-dim)' }}>
          {selectedSong?.title ?? 'Resultado'}
        </h2>

        <div className="grade-display">
          <div
            className="grade-ring"
            style={{
              background: `linear-gradient(135deg, ${gradeColor}, ${gradeColor}99)`,
              boxShadow: `0 0 40px ${gradeColor}88`,
              opacity: visible ? 1 : 0,
              transform: visible ? 'scale(1)' : 'scale(0)',
              transition: 'transform 0.4s ease, opacity 0.4s ease',
            }}
          >
            <div className="grade-letter">{grade}</div>
          </div>
        </div>

        <div className="results-stats">
          <div className="result-row">
            <span>Pontuação Final</span>
            <span>{score.toLocaleString()}</span>
          </div>
          <div className="result-row">
            <span>Precisão</span>
            <span>{accuracy}%</span>
          </div>
          <div className="result-row">
            <span>Notas Acertadas</span>
            <span>{hits} / {total}</span>
          </div>
          <div className="result-row">
            <span>Maior Combo</span>
            <span>{maxCombo}</span>
          </div>
        </div>

        <div className="results-buttons">
          <button className="btn-primary" onClick={handleRetry}>
            ↺ Tentar Novamente
          </button>
          <button className="btn-secondary" onClick={() => navigate('menu')}>
            Menu Principal
          </button>
        </div>
      </div>
    </div>
  )
}
