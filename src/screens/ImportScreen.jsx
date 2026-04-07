import { useState, useRef } from 'react'
import { SongImporter } from '../lib/SongImporter.js'
import { saveImportedSong } from '../lib/songs.js'

export default function ImportScreen({ navigate, audioBuffers }) {
  const [status, setStatus]       = useState('Aguardando arquivo…')
  const [progress, setProgress]   = useState(0)
  const [titleInput, setTitle]    = useState('')
  const [bpmInput, setBpm]        = useState('0')
  const [pendingSong, setPending] = useState(null)
  const [pendingBuf, setPendingBuf] = useState(null)
  const [preview, setPreview]     = useState(null)
  const [isDragOver, setDragOver] = useState(false)

  const tapTimesRef = useRef([])
  const importerRef = useRef(new SongImporter())
  const fileInputRef = useRef(null)

  const startAnalysis = (file) => {
    const ext = file.name.split('.').pop().toLowerCase()
    if (!['mp3','wav','ogg','m4a','flac'].includes(ext)) {
      setStatus('Formato não suportado. Use MP3, WAV, OGG ou M4A.')
      return
    }

    setPending(null)
    setPendingBuf(null)
    setPreview(null)
    setProgress(0)

    const guessed = file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ')
    if (!titleInput) setTitle(guessed)

    const bpm = parseInt(bpmInput) || 0
    setStatus('Iniciando análise…')

    const importer = importerRef.current
    importer.onProgress = (pct, msg) => {
      setProgress(pct)
      setStatus(msg)
    }
    importer.onComplete = (song) => {
      setPending(song)
      setPendingBuf(importer.lastAudioBuffer)
      setTitle(song.title)
      setBpm(String(song.bpm))
      setPreview(song)
    }
    importer.onError = (msg) => setStatus(msg)

    importer.analyzeFile(file, titleInput || guessed, bpm)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) startAnalysis(f)
  }

  const handleFileChange = (e) => {
    if (e.target.files[0]) startAnalysis(e.target.files[0])
  }

  const handleTap = () => {
    const now = Date.now()
    let times = tapTimesRef.current
    times.push(now)
    times = times.filter(t => now - t < 5000).slice(-8)
    tapTimesRef.current = times
    if (times.length >= 2) {
      const avg = (times[times.length - 1] - times[0]) / (times.length - 1)
      setBpm(String(Math.round(60000 / avg)))
    }
  }

  const handleAddSong = () => {
    if (!pendingSong) return
    const finalSong = { ...pendingSong }
    if (titleInput.trim()) finalSong.title = titleInput.trim()
    saveImportedSong(finalSong)
    if (pendingBuf) audioBuffers.set(finalSong.id, pendingBuf)
    navigate('menu')
  }

  const handleBack = () => {
    setPending(null); setPendingBuf(null); setPreview(null)
    tapTimesRef.current = []
    navigate('menu')
  }

  return (
    <div className="screen active" id="screen-import">
      <div className="import-container">
        <h2>Importar Música</h2>
        <p className="import-hint">
          Carregue um MP3 ou WAV com uma melodia simples (saxofone, flauta, voz…)
          e o jogo detecta as notas automaticamente.
        </p>

        <div className="import-body">
          <div className="import-left">
            <div
              className={`upload-zone${isDragOver ? ' drag-over' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="upload-icon">🎼</div>
              <p>Arraste um arquivo MP3 / WAV aqui</p>
              <p className="upload-sub">ou clique para selecionar</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".mp3,.wav,.ogg,.m4a"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </div>

            <div className="import-fields">
              <div className="field-row">
                <label>Nome da música</label>
                <input
                  type="text"
                  value={titleInput}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Ex: Tema do Filme X"
                  maxLength={60}
                />
              </div>
              <div className="field-row">
                <label>BPM <small>(0 = detectar automaticamente)</small></label>
                <div className="bpm-row">
                  <input
                    type="number"
                    value={bpmInput}
                    onChange={e => setBpm(e.target.value)}
                    min="0" max="300" step="1"
                  />
                  <button className="btn-secondary" onClick={handleTap}>Tap ♩</button>
                </div>
              </div>
            </div>
          </div>

          <div className="import-right">
            <div id="import-progress-wrap">
              <div className="progress-bar-wrap" style={{ height: 8, borderRadius: 4 }}>
                <div
                  className="progress-bar"
                  style={{ width: progress + '%', borderRadius: 4 }}
                />
              </div>
              <p className="import-status-text">{status}</p>
            </div>

            {preview && (
              <div className="import-result">
                <div className="import-stat">
                  <strong>{preview.notes.length}</strong> notas detectadas
                </div>
                <div className="import-stat">
                  BPM: <strong>{preview.bpm}</strong>
                </div>
                <div className="import-stat">
                  Notas: <strong>{[...new Set(preview.notes.map(n => n.note))].sort().join(' ')}</strong>
                </div>
                <div className="import-tip" style={{ fontSize: '.78rem', color: 'var(--text-dim)' }}>
                  Se as notas estiverem erradas, tente informar o BPM manualmente e refaça a análise.
                  Funciona melhor com gravações de melodia isolada (sem bateria/harmonia).
                </div>
                <div className="import-notes-preview">
                  {preview.notes.slice(0, 48).map((n, i) => (
                    <span key={i} className="preview-note">{n.note}</span>
                  ))}
                  {preview.notes.length > 48 && (
                    <span className="preview-note muted">+{preview.notes.length - 48}</span>
                  )}
                </div>
              </div>
            )}

            <div className="import-actions">
              <button className="btn-secondary" onClick={handleBack}>← Voltar</button>
              <button
                className="btn-primary"
                disabled={!pendingSong}
                onClick={handleAddSong}
              >+ Adicionar ao Jogo</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
