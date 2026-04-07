/**
 * Demo — Figuras Musicais
 * SaxHero — BPM 60 — Dificuldade 1
 *
 * 7 compassos de 4/4 demonstrando todas as figuras rítmicas:
 *   C1: semibreve   (1 nota  × 4 tempos)
 *   C2: mínima      (2 notas × 2 tempos)
 *   C3: semínima    (4 notas × 1 tempo)
 *   C4: colcheia    (8 notas × 0,5 tempo)
 *   C5: semicolcheia(16 notas × 0,25 tempo — sobe e desce a escala)
 *   C6: fusa        (32 notas × 0,125 tempo)
 *   C7: semifusa    (64 notas × 0,0625 tempo)
 *
 * Tom de concerto (Dó maior).
 */
import { beats } from "./utils.js";

const BPM = 60;
const SCALE = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"];

function _buildNotes() {
  const notes = [];

  // Compasso 1: 1 semibreve (4 tempos)
  notes.push(["C4", 0, 4]);

  // Compasso 2: 2 mínimas (2 tempos cada)
  notes.push(["C4", 4, 2], ["G4", 6, 2]);

  // Compasso 3: 4 semínimas (1 tempo cada)
  for (let i = 0; i < 4; i++) {
    notes.push([SCALE[i], 8 + i, 1]);
  }

  // Compasso 4: 8 colcheias (0,5 tempo cada)
  for (let i = 0; i < 8; i++) {
    notes.push([SCALE[i], 12 + i * 0.5, 0.5]);
  }

  // Compasso 5: 16 semicolcheias (0,25 tempo cada) — sobe e desce a escala
  const scaleUpDown = [...SCALE, ...SCALE.slice().reverse()];
  for (let i = 0; i < 16; i++) {
    notes.push([scaleUpDown[i], 16 + i * 0.25, 0.25]);
  }

  // Compasso 6: 32 fusas (0,125 tempo cada)
  for (let i = 0; i < 32; i++) {
    notes.push([SCALE[i % 8], 20 + i * 0.125, 0.125]);
  }

  // Compasso 7: 64 semifusas (0,0625 tempo cada)
  for (let i = 0; i < 64; i++) {
    notes.push([SCALE[i % 8], 24 + i * 0.0625, 0.0625]);
  }

  return notes;
}

export const demoFiguras = {
  id: "demo_figuras",
  title: "Demo — Figuras Musicais",
  author: "SaxHero",
  difficulty: 1,
  bpm: BPM,
  notes: beats(_buildNotes(), BPM),
};
