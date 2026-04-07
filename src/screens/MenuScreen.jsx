import { useEffect, useState } from 'react'
import { getAllSongs } from '../lib/songs.js'

export default function MenuScreen({
  navigate,
  selectedSong, setSelectedSong,
  audioBuffers,
}) {
  const [songs, setSongs] = useState(() => getAllSongs())

  useEffect(() => {
    setSongs(getAllSongs())
  }, [])

  const handleSongClick = async (song) => {
    setSelectedSong(song)
    if (song.audioSrc && !audioBuffers.has(song.id)) {
      try {
        const resp     = await fetch(song.audioSrc)
        if (!resp.ok) return
        const arrayBuf = await resp.arrayBuffer()
        const tmpCtx   = new AudioContext()
        const audioBuf = await tmpCtx.decodeAudioData(arrayBuf)
        await tmpCtx.close()
        audioBuffers.set(song.id, audioBuf)
        console.log('[MenuScreen] Áudio pré-carregado:', song.audioSrc)
      } catch (e) {
        console.warn('[MenuScreen] Não foi possível pré-carregar áudio:', e)
      }
    }
  }

  const handleStart = () => {
    if (!selectedSong) return
    navigate('calibration')
  }

  return (
    <div className="screen active" id="screen-menu">
      <div className="menu-container">
        <div className="menu-header">
          <div className="logo">SaxHero</div>
          <p className="tagline">Aprenda saxofone tocando!</p>
        </div>

        <div className="menu-body">
          <div className="song-panel">
            <h3>Escolha uma música</h3>
            <div id="song-list">
              {songs.map(song => {
                const isSelected = selectedSong?.id === song.id
                return (
                  <div
                    key={song.id}
                    className={`song-item${isSelected ? ' selected' : ''}`}
                    onClick={() => handleSongClick(song)}
                  >
                    <div>
                      <div className="song-title">{song.title}</div>
                      <div className="song-meta">{song.author} · {song.bpm} BPM</div>
                    </div>
                    <div className="song-item-right">
                      <div className="song-stars">{'⭐'.repeat(song.difficulty)}</div>
                      {isSelected && (
                        <button
                          className="btn-play"
                          onClick={(e) => { e.stopPropagation(); handleStart() }}
                        >▶</button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
