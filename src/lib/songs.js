/**
 * Song database — notes defined as [noteName, startBeat, durationInBeats]
 * All songs use concert pitch (what the microphone hears).
 */

function beats(arr, bpm) {
  const spb = 60 / bpm;
  const minBeat = arr.length ? Math.min(...arr.map(([, b]) => b)) : 0;
  return arr.map(([note, beat, dur]) => ({
    note,
    time: beat * spb,
    duration: dur * spb,
    beatStart: beat - minBeat, // relative to first note
    durationBeats: dur,
  }));
}

// ── A Ele a Glória — builders ────────────────────────────────────────────
// Concert pitch for alto sax  (escrita → concerto):
//   La(A)=C4   Si(B)=D4   Do(C)=D#4   Re(D)=F4
//   Mi(E)=G4   Fa(F)=G#4  Sol(G)=A#3

// Verso — 6 compassos × 4 tempos = 24 beats
// C1: La♪ La♪ La♪ Si♪  Do♩  Do♩        (♪=0.5, ♩=1  → 4 tempos)
// C2: La𝅗𝅥.                             (mínima com ponto = 3t + 1t pausa)
// C3: Si♩  Do♩. Do♪                     (1 + 1.5 + 0.5 + 1pausa = 4 tempos)
// C4: Si♩  Si♩  La𝅗𝅥                    (1 + 1 + 2 = 4 tempos)
// C5: La♩  Sol♩ La𝅗𝅥                    (1 + 1 + 2 = 4 tempos)
// C6: La𝅗𝅥.                             (mínima com ponto = 3t + 1t pausa)
function _verso(s) {
  return [
    // C1
    ["C4", s + 0, 0.5],
    ["C4", s + 0.5, 0.5],
    ["C4", s + 1, 0.5],
    ["D4", s + 1.5, 0.5],
    ["D#4", s + 2, 1],
    ["D#4", s + 3, 1],
    // C2: La mínima com ponto (3 tempos, 1 pausa antes de C3)
    ["C4", s + 4, 3],
    // C3: Si♩ Do♩. Do♪  (pausa de 1 tempo preenche o compasso)
    ["D4", s + 8, 1],
    ["D#4", s + 9, 1.5],
    ["D#4", s + 10.5, 0.5],
    // C4
    ["D4", s + 12, 1],
    ["D4", s + 13, 1],
    ["C4", s + 14, 2],
    // C5
    ["C4", s + 16, 1],
    ["A#3", s + 17, 1],
    ["C4", s + 18, 2],
    // C6: La mínima com ponto (3 tempos)
    ["C4", s + 20, 3],
  ];
}

// Refrão parte 1 — 6 compassos × 4 tempos = 24 beats
// C1: Do♩ Re♩ Mi♩ Fa♩
// C2: Mi𝅗𝅥.   (mínima com ponto = 3t + 1t pausa)
// C3: Re𝅗𝅥.   (mínima com ponto = 3t + 1t pausa)
// C4: Si♩ Do♩. Re♪  (1 + 1.5 + 0.5 + 1pausa = 4 tempos)
// C5: Mi♩ Re♩ Do♩ Re♩
// C6: Do♩ Si♩ Do𝅗𝅥
function _refrao1(s) {
  return [
    // C1
    ["D#4", s + 0, 1],
    ["F4", s + 1, 1],
    ["G4", s + 2, 1],
    ["G#4", s + 3, 1],
    // C2: Mi mínima com ponto
    ["G4", s + 4, 3],
    // C3: Re mínima com ponto
    ["F4", s + 8, 3],
    // C4: Si♩ Do♩. Re♪
    ["D4", s + 12, 1],
    ["D#4", s + 13, 1.5],
    ["F4", s + 14.5, 0.5],
    // C5
    ["G4", s + 16, 1],
    ["F4", s + 17, 1],
    ["D#4", s + 18, 1],
    ["F4", s + 19, 1],
    // C6
    ["D#4", s + 20, 1],
    ["D4", s + 21, 1],
    ["D#4", s + 22, 2],
  ];
}

// Refrão parte 2 — 5 compassos × 4 tempos = 20 beats
// C1: La♩  Si♩  Do𝅗𝅥
// C2: Do𝅗𝅥.   (mínima com ponto = 3t + 1t pausa)
// C3: Si𝅗𝅥.   (mínima com ponto = 3t + 1t pausa)
// C4: Si♩  Do♩  Si♩  Sol♩
// C5: La𝅗𝅥.   (mínima com ponto = 3t + fim de seção)
function _refrao2(s) {
  return [
    // C1
    ["C4", s + 0, 1],
    ["D4", s + 1, 1],
    ["D#4", s + 2, 2],
    // C2: Do mínima com ponto
    ["D#4", s + 4, 3],
    // C3: Si mínima com ponto
    ["D4", s + 8, 3],
    // C4
    ["D4", s + 12, 1],
    ["D#4", s + 13, 1],
    ["D4", s + 14, 1],
    ["A#3", s + 15, 1],
    // C5: La mínima com ponto (final da seção)
    ["C4", s + 16, 3],
  ];
}

// ── Demo — Figuras Musicais ─────────────────────────────────────────────────
// 7 compassos de 4/4: semibreve, mínima, semínima, colcheia,
// semicolcheia, fusa e semifusa. Tom de concerto (Dó maior).
function _demoFiguras() {
  const sc = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"];
  const notes = [];
  // Compasso 1: 1 semibreve (4 tempos)
  notes.push(["C4", 0, 4]);
  // Compasso 2: 2 mínimas (2 tempos cada)
  notes.push(["C4", 4, 2], ["G4", 6, 2]);
  // Compasso 3: 4 semínimas (1 tempo cada)
  for (let i = 0; i < 4; i++) notes.push([sc[i], 8 + i, 1]);
  // Compasso 4: 8 colcheias (0,5 tempo cada)
  for (let i = 0; i < 8; i++) notes.push([sc[i], 12 + i * 0.5, 0.5]);
  // Compasso 5: 16 semicolcheias (0,25 tempo cada) — sobe e desce a escala
  const s5 = [...sc, ...sc.slice().reverse()];
  for (let i = 0; i < 16; i++) notes.push([s5[i], 16 + i * 0.25, 0.25]);
  // Compasso 6: 32 fusas (0,125 tempo cada)
  for (let i = 0; i < 32; i++) notes.push([sc[i % 8], 20 + i * 0.125, 0.125]);
  // Compasso 7: 64 semifusas (0,0625 tempo cada)
  for (let i = 0; i < 64; i++) notes.push([sc[i % 8], 24 + i * 0.0625, 0.0625]);
  return notes;
}

const SONGS = [
  {
    id: "demo_figuras",
    title: "Demo — Figuras Musicais",
    author: "SaxHero",
    difficulty: 1,
    bpm: 60,
    notes: beats(_demoFiguras(), 60),
  },
  {
    // A introdução do MP3 dura ~26s → sax entra no beat 28.2 (26 × 65/60).
    // Estrutura: [Verso×4 + Refrão×2] × 2  (páginas esquerda e direita da partitura)
    id: "a_ele_a_gloria",
    title: "A Ele a Glória",
    author: "Hinário",
    difficulty: 3,
    bpm: 65,
    audioSrc: "/A ele a gloria.mp3",
    notes: (() => {
      const V = 24; // beats por verso
      const R1 = 24; // beats por refrão pt1
      const R2 = 20; // beats por refrão pt2
      const R = R1 + R2; // 44 beats por refrão completo
      const o = 28.2; // beat de entrada do sax (~26s)

      // ── 1ª metade (página esquerda) ─────────────────────────────
      const v1 = o;
      const v2 = v1 + V;
      const v3 = v2 + V;
      const v4 = v3 + V;
      const c1 = v4 + V; // refrão 1ª vez
      const c2 = c1 + R; // refrão 2ª vez

      // ── 2ª metade (página direita) ───────────────────────────────
      const v5 = c2 + R;
      const v6 = v5 + V;
      const v7 = v6 + V;
      const v8 = v7 + V;
      const c3 = v8 + V; // refrão 3ª vez
      const c4 = c3 + R; // refrão 4ª vez

      return beats(
        [
          ..._verso(v1),
          ..._verso(v2),
          ..._verso(v3),
          ..._verso(v4),
          ..._refrao1(c1),
          ..._refrao2(c1 + R1),
          ..._refrao1(c2),
          ..._refrao2(c2 + R1),

          ..._verso(v5),
          ..._verso(v6),
          ..._verso(v7),
          ..._verso(v8),
          ..._refrao1(c3),
          ..._refrao2(c3 + R1),
          ..._refrao1(c4),
          ..._refrao2(c4 + R1),
        ],
        65,
      );
    })(),
  },
];

// ── Músicas importadas (persistidas em localStorage) ─────────────

function getAllSongs() {
  return [...SONGS, ...loadImportedSongs()];
}

function loadImportedSongs() {
  try {
    return JSON.parse(localStorage.getItem("saxhero_songs") ?? "[]");
  } catch {
    return [];
  }
}

function saveImportedSong(song) {
  const list = loadImportedSongs();
  list.push(song);
  localStorage.setItem("saxhero_songs", JSON.stringify(list));
}

function deleteImportedSong(id) {
  const list = loadImportedSongs().filter((s) => s.id !== id);
  localStorage.setItem("saxhero_songs", JSON.stringify(list));
}

export {
  SONGS,
  getAllSongs,
  loadImportedSongs,
  saveImportedSong,
  deleteImportedSong,
};
