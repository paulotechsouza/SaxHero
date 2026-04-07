/**
 * Parabéns pra Você
 * Tradicional — BPM 100 — Dificuldade 1
 *
 * Gerado automaticamente por scripts/compile-song.js
 * Arquivo fonte: (edite o .song, não este arquivo)
 */
import { beats } from "./utils.js";

const _notes = [
  ["A#3", 1, 0.5],
  ["A#3", 1.5, 0.5],
  ["C4", 2, 1],
  ["A#3", 3, 1],
  ["D#4", 4, 1],
  ["D4", 5, 2],
  ["A#3", 7, 1],
  ["A#3", 8, 0.5],
  ["A#3", 8.5, 0.5],
  ["C4", 9, 1],
  ["A#3", 10, 1],
  ["F4", 11, 2],
  ["A#3", 13, 1],
  ["A#3", 14, 0.5],
  ["A#3", 14.5, 0.5],
  ["A#4", 15, 1],
  ["G4", 16, 1],
  ["D#4", 17, 2],
  ["D4", 19, 1],
  ["D4", 20, 0.5],
  ["D4", 20.5, 0.5],
  ["C4", 21, 1],
  ["C4", 22, 1],
  ["A4", 23, 3],
];

export const parabensPraVoce = {
  id: "parabens_pra_voce",
  title: "Parabéns pra Você",
  author: "Tradicional",
  difficulty: 1,
  bpm: 100,
  timeSignature: { numerator: 3, denominator: 4 },
  notes: beats(_notes, 100),
};
