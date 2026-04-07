import { useState, useRef, useCallback } from 'react'
import MenuScreen from './screens/MenuScreen.jsx'
import ImportScreen from './screens/ImportScreen.jsx'
import CalibrationScreen from './screens/CalibrationScreen.jsx'
import GameScreen from './screens/GameScreen.jsx'
import ResultsScreen from './screens/ResultsScreen.jsx'

export default function App() {
  const [screen, setScreen] = useState('menu')

  // Estado global do jogo
  const [selectedSong, setSelectedSong] = useState(null)
  const [results, setResults]           = useState(null)

  const saxType    = 'alto'
  const difficulty = 'easy'
  const speedMult  = 1.0

  // Buffers de áudio compartilhados entre telas (songId → AudioBuffer)
  const audioBuffersRef = useRef(new Map())

  const navigate = useCallback((nextScreen, data) => {
    if (data?.results) setResults(data.results)
    setScreen(nextScreen)
  }, [])

  const commonProps = {
    navigate,
    selectedSong, setSelectedSong,
    saxType,
    difficulty,
    speedMult,
    audioBuffers: audioBuffersRef.current,
  }

  return (
    <>
      {screen === 'menu'        && <MenuScreen        {...commonProps} />}
      {screen === 'import'      && <ImportScreen      {...commonProps} />}
      {screen === 'calibration' && <CalibrationScreen {...commonProps} />}
      {screen === 'game'        && (
        <GameScreen
          {...commonProps}
          onEnd={(r) => { setResults(r); navigate('results') }}
        />
      )}
      {screen === 'results' && (
        <ResultsScreen
          {...commonProps}
          results={results}
          onRetry={() => navigate('game')}
        />
      )}
    </>
  )
}
