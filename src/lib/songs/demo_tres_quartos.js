/**
 * Demo — Valsa em 3/4
 * SaxHero — BPM 120 — Dificuldade 1
 *
 * Melodia simples para demonstrar a fórmula de compasso 3/4.
 * Cada compasso tem 3 tempos (♩ = 1 tempo).
 *
 * ⚠️  ATENÇÃO — TOM DE CONCERTO vs. NOTA ESCRITA
 * Todas as notas são armazenadas em TOM DE CONCERTO (o que o microfone ouve).
 * O engine transpõe +9 semitons para saxofone alto ao renderizar a partitura:
 *   concerto → escrita (alto sax)
 *   C4       → A4  /  E4 → C#5  /  G4 → E5  etc.
 *
 * Notas no código   →   O que aparece na partitura (saxofone alto)
 * ──────────────────────────────────────────────────────────────────
 * Estrutura (8 compassos, Lá maior escrita):
 *   C1: [C4  E4  G4 ]♩  →  Lá♩   Dó#♩  Mi♩      (arpejo de Lá maior)
 *   C2: [F4  A4  C5 ]♩  →  Ré♩   Fá#♩  Lá5♩     (arpejo de Ré maior)
 *   C3: [B4  G4  E4 ]♩  →  Sol#♩ Mi♩   Dó#♩     (descendendo)
 *   C4: [F4♩. D4♩   ]   →  Ré♩.  Si♩              (pontuada + semínima)
 *   C5: [E4♩ F4♪ E4♪ D4♩] → Dó#♩ Ré♪ Dó#♪ Si♩  (misto)
 *   C6: [C4  D4  E4 ]♩  →  Lá♩   Si♩   Dó#♩     (subindo)
 *   C7: [G4  F4  E4 ]♩  →  Mi♩   Ré♩   Dó#♩     (descendendo)
 *   C8: [C4𝅗𝅥.       ]   →  Lá𝅗𝅥.               (mínima pontuada, 3 tempos)
 */
import { beats } from "./utils.js";

const BPM = 120;

// Cada compasso = 3 semínimas → múltiplos de 3 para os beats de início.
// Notas em TOM DE CONCERTO — a partitura exibe a nota escrita (+9 para alto sax).
const notes = [
  // C1 — concerto C-E-G → escrita Lá♩ Dó#♩ Mi♩ (arpejo de Lá maior)
  ["C4", 0, 1],
  ["E4", 1, 1],
  ["G4", 2, 1],

  // C2 — concerto F-A-C5 → escrita Ré♩ Fá#♩ Lá5♩ (arpejo de Ré maior)
  ["F4", 3, 1],
  ["A4", 4, 1],
  ["C5", 5, 1],

  // C3 — concerto B-G-E → escrita Sol#♩ Mi♩ Dó#♩ (descendendo)
  ["B4", 6, 1],
  ["G4", 7, 1],
  ["E4", 8, 1],

  // C4 — concerto F♩. D♩ → escrita Ré♩. Si♩ (pontuada + semínima)
  ["F4", 9, 1.5],
  ["D4", 10.5, 1.5],

  // C5 — concerto E♩ F♪ E♪ D♩ → escrita Dó#♩ Ré♪ Dó#♪ Si♩
  ["E4", 12, 1],
  ["F4", 13, 0.5],
  ["E4", 13.5, 0.5],
  ["D4", 14, 1],

  // C6 — concerto C-D-E → escrita Lá♩ Si♩ Dó#♩ (subindo)
  ["C4", 15, 1],
  ["D4", 16, 1],
  ["E4", 17, 1],

  // C7 — concerto G-F-E → escrita Mi♩ Ré♩ Dó#♩ (descendendo)
  ["G4", 18, 1],
  ["F4", 19, 1],
  ["E4", 20, 1],

  // C8 — concerto C𝅗𝅥. → escrita Lá𝅗𝅥. (mínima pontuada = 3 tempos)
  ["C4", 21, 3],
];

export const demo34 = {
  id: "demo_3_4",
  title: "Demo — Valsa 3/4",
  author: "SaxHero",
  difficulty: 1,
  bpm: BPM,
  timeSignature: { numerator: 3, denominator: 4 },
  notes: beats(notes, BPM),
};
