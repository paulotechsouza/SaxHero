import { useState, useRef, useEffect, useCallback } from "react";
import {
  GameEngine,
  SAX_TRANSPOSITIONS,
  midiToNoteName,
} from "../lib/GameEngine.js";
import { noteNameToMidi } from "../lib/PitchDetector.js";

// ── Tabelas ──────────────────────────────────────────────────────────────────

const SOLFEJO = ["Dó", "Ré", "Mi", "Fá", "Sol", "Lá", "Si"];
const EN_NOTE = ["C", "D", "E", "F", "G", "A", "B"];
// Semitones from C: which degrees have a natural sharp
const HAS_SHARP = [true, true, false, true, true, true, false]; // C D E F G A B (E e B sem #)
const HAS_FLAT = [false, true, true, false, true, true, true]; // D E F G A B C (C e F sem b)

const DURATIONS = [
  { key: "sb", label: "𝅝", beats: 4, title: "Semibreve (4 tempos)" },
  { key: "m", label: "𝅗𝅥", beats: 2, title: "Mínima (2 tempos)" },
  { key: "m.", label: "𝅗𝅥.", beats: 3, title: "Mínima pontuada (3 tempos)" },
  { key: "s", label: "♩", beats: 1, title: "Semínima (1 tempo)" },
  {
    key: "s.",
    label: "♩.",
    beats: 1.5,
    title: "Semínima pontuada (1,5 tempo)",
  },
  { key: "c", label: "♪", beats: 0.5, title: "Colcheia (0,5 tempo)" },
  {
    key: "c.",
    label: "♪.",
    beats: 0.75,
    title: "Colcheia pontuada (0,75 tempo)",
  },
  { key: "sc", label: "𝅘𝅥𝅯", beats: 0.25, title: "Semicolcheia (0,25 tempo)" },
];

const TIME_SIGS = ["2/4", "3/4", "4/4", "6/8", "12/8"];
const OCTAVES = [3, 4, 5];

// Nomes de notas SaxHero a partir de índice de grau + oitava + acidente
function buildNoteName(degreeIdx, octave, accident) {
  return `${EN_NOTE[degreeIdx]}${accident}${octave}`;
}

function buildDisplayName(degreeIdx, octave, accident) {
  return `${SOLFEJO[degreeIdx]}${accident ? (accident === "#" ? "♯" : "♭") : ""}${octave}`;
}

// Converte pitch escrito (o que o saxofonista lê) → pitch de concerto (armazenado no engine)
function writtenToConcert(noteName, saxType) {
  const offset = SAX_TRANSPOSITIONS[saxType] ?? 0;
  return midiToNoteName(noteNameToMidi(noteName) - offset);
}

// Constrói objeto de música compatível com GameEngine a partir do estado do compositor
function buildSong({ title, author, bpm, timeSig, notes, saxType }) {
  const [numStr, denStr] = timeSig.split("/");
  const numerator = parseInt(numStr, 10);
  const denominator = parseInt(denStr, 10);
  const spb = 60 / bpm;

  let beat = 0;
  const converted = notes
    .map((n) => {
      const obj = {
        note: n.isRest ? "R" : writtenToConcert(n.name, saxType),
        time: beat * spb,
        duration: n.beats * spb,
        beatStart: beat,
        durationBeats: n.beats,
      };
      beat += n.beats;
      return obj;
    })
    .filter((n) => !n.note.startsWith("R")); // pausas não renderizam nota

  return {
    id: "composer_preview",
    title,
    author,
    bpm,
    difficulty: 1,
    timeSignature: { numerator, denominator },
    notes: converted,
  };
}

// ── Componente principal ─────────────────────────────────────────────────────

export default function ComposerScreen({ navigate, saxType = "alto" }) {
  // Metadados
  const [title, setTitle] = useState("Nova Música");
  const [author, setAuthor] = useState("");
  const [bpm, setBpm] = useState(120);
  const [timeSig, setTimeSig] = useState("4/4");

  // Seleção atual de nota
  const [selDegree, setSelDegree] = useState(0); // 0=Dó..6=Si
  const [selOctave, setSelOctave] = useState(4);
  const [selAccident, setSelAccident] = useState(""); // '' | '#' | 'b'
  const [selDur, setSelDur] = useState("s"); // chave de DURATIONS

  // Sequência de notas inseridas
  const [notes, setNotes] = useState([]);

  // Canvas do preview
  const canvasRef = useRef(null);
  const engineRef = useRef(null);

  // Inicializa o engine uma vez
  useEffect(() => {
    if (!canvasRef.current) return;
    engineRef.current = new GameEngine(canvasRef.current, {});
  }, []);

  // Redesenha sempre que notas, bpm ou compasso mudam
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || notes.length === 0) {
      // Limpa o canvas se não houver notas
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext("2d");
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      return;
    }
    const song = buildSong({ title, author, bpm, timeSig, notes, saxType });
    engine.setup(song, "easy", 1.0, saxType);
    engine.drawStatic();
  }, [notes, bpm, timeSig, title, author, saxType]);

  // ── Ações ────────────────────────────────────────────────────────────────

  const durObj = DURATIONS.find((d) => d.key === selDur) ?? DURATIONS[3];

  const addNote = useCallback(() => {
    const name = buildNoteName(selDegree, selOctave, selAccident);
    setNotes((prev) => [
      ...prev,
      {
        name,
        beats: durObj.beats,
        isRest: false,
        label: buildDisplayName(selDegree, selOctave, selAccident),
      },
    ]);
  }, [selDegree, selOctave, selAccident, durObj]);

  const addRest = useCallback(() => {
    setNotes((prev) => [
      ...prev,
      {
        name: "R",
        beats: durObj.beats,
        isRest: true,
        label: `pausa(${durObj.label})`,
      },
    ]);
  }, [durObj]);

  const removeLast = useCallback(() => {
    setNotes((prev) => prev.slice(0, -1));
  }, []);

  const clearAll = useCallback(() => {
    if (window.confirm("Apagar todas as notas?")) setNotes([]);
  }, []);

  // Exporta como arquivo .song
  const exportSong = useCallback(() => {
    const lines = [
      `TITULO:      ${title}`,
      `AUTOR:       ${author || "Desconhecido"}`,
      `ID:          ${title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .slice(0, 40)}`,
      `BPM:         ${bpm}`,
      `COMPASSO:    ${timeSig}`,
      `SAX:         ${saxType}`,
      `DIFICULDADE: 2`,
      "",
      "# Notas geradas pelo Compositor",
    ];

    // Agrupa em linhas de 4 tokens
    const tokens = notes.map((n) =>
      n.isRest
        ? `---:${n.beats}`
        : `${n.label.replace("♯", "#").replace("♭", "b")}:${n.beats}`,
    );
    for (let i = 0; i < tokens.length; i += 4) {
      lines.push(tokens.slice(i, i + 4).join("  "));
    }

    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/[^a-z0-9]/gi, "_")}.song`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [title, author, bpm, timeSig, saxType, notes]);

  // ── Render ───────────────────────────────────────────────────────────────

  const noteListEl = useRef(null);
  useEffect(() => {
    if (noteListEl.current) noteListEl.current.scrollLeft = 99999;
  }, [notes]);

  return (
    <div className="screen active" id="screen-composer">
      <div className="composer-layout">
        {/* ── Barra de topo ─────────────────────────────────── */}
        <header className="composer-header">
          <button className="btn-back" onClick={() => navigate("menu")}>
            ← Voltar
          </button>
          <input
            className="composer-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Nome da música"
          />
          <input
            className="composer-author-input"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Autor"
          />
        </header>

        {/* ── Partitura preview ─────────────────────────────── */}
        <div className="composer-canvas-wrap">
          <canvas
            ref={canvasRef}
            className="composer-canvas"
            width={900}
            height={260}
          />
          {notes.length === 0 && (
            <div className="composer-empty">
              Selecione uma nota e clique em <strong>+ Nota</strong> para
              começar
            </div>
          )}
        </div>

        {/* ── Fila de notas inseridas ───────────────────────── */}
        <div className="composer-note-list" ref={noteListEl}>
          {notes.map((n, i) => (
            <span
              key={i}
              className={`composer-chip ${n.isRest ? "rest" : ""}`}
              title={`Nota ${i + 1}: ${n.label} (${n.beats} tempos)`}
            >
              {n.isRest ? `𝄽 ${n.beats}` : n.label}
            </span>
          ))}
          {notes.length > 0 && (
            <button
              className="composer-chip remove"
              onClick={removeLast}
              title="Remover última nota"
            >
              ✕
            </button>
          )}
        </div>

        {/* ── Paleta de controles ───────────────────────────── */}
        <div className="composer-controls">
          {/* Figuras de duração */}
          <section className="ctrl-section">
            <label>Figura</label>
            <div className="ctrl-row">
              {DURATIONS.map((d) => (
                <button
                  key={d.key}
                  className={`btn-dur ${selDur === d.key ? "active" : ""}`}
                  title={d.title}
                  onClick={() => setSelDur(d.key)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </section>

          {/* Acidentes */}
          <section className="ctrl-section">
            <label>Acidente</label>
            <div className="ctrl-row">
              {["b", "", "#"].map((acc) => (
                <button
                  key={acc || "nat"}
                  className={`btn-acc ${selAccident === acc ? "active" : ""}`}
                  onClick={() => setSelAccident(acc)}
                >
                  {acc === "#" ? "♯" : acc === "b" ? "♭" : "♮"}
                </button>
              ))}
            </div>
          </section>

          {/* Oitava */}
          <section className="ctrl-section">
            <label>Oitava</label>
            <div className="ctrl-row">
              {OCTAVES.map((o) => (
                <button
                  key={o}
                  className={`btn-oct ${selOctave === o ? "active" : ""}`}
                  onClick={() => setSelOctave(o)}
                >
                  {o}
                </button>
              ))}
            </div>
          </section>

          {/* Teclado de notas */}
          <section className="ctrl-section ctrl-notes">
            <label>Nota</label>
            <div className="ctrl-row note-keys">
              {SOLFEJO.map((sol, i) => (
                <button
                  key={i}
                  className={`btn-note ${selDegree === i ? "active" : ""}`}
                  onClick={() => setSelDegree(i)}
                >
                  {sol}
                </button>
              ))}
            </div>
          </section>

          {/* Ações */}
          <section className="ctrl-section ctrl-actions">
            <button className="btn-add" onClick={addNote}>
              + Nota&nbsp;
              <em>
                {buildDisplayName(selDegree, selOctave, selAccident)}&nbsp;
                {durObj.label}
              </em>
            </button>
            <button className="btn-rest" onClick={addRest}>
              𝄽 Pausa&nbsp;<em>{durObj.label}</em>
            </button>
          </section>
        </div>

        {/* ── Rodapé: metadados + exportar ────────────────── */}
        <footer className="composer-footer">
          <label>
            BPM
            <input
              type="number"
              min="40"
              max="300"
              value={bpm}
              onChange={(e) => setBpm(Number(e.target.value))}
            />
          </label>
          <label>
            Compasso
            <select
              value={timeSig}
              onChange={(e) => setTimeSig(e.target.value)}
            >
              {TIME_SIGS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <div className="footer-spacer" />
          <button
            className="btn-clear"
            onClick={clearAll}
            disabled={notes.length === 0}
          >
            🗑 Limpar
          </button>
          <button
            className="btn-export"
            onClick={exportSong}
            disabled={notes.length === 0}
          >
            ↓ Exportar .song
          </button>
        </footer>
      </div>
    </div>
  );
}
