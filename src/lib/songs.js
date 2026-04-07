/**
 * Banco de músicas — índice central.
 * Cada música vive em seu próprio arquivo em songs/.
 * Para adicionar uma nova música: crie songs/<id>.js e importe aqui.
 */
import { demoFiguras } from "./songs/demo_figuras.js";
import { demo34 } from "./songs/demo_tres_quartos.js";
import { aEleAGloria } from "./songs/a_ele_a_gloria.js";
import { parabensPraVoce } from "./songs/parabens_pra_voce.js";

// Re-exporta beats() para que código legado continue funcionando
export { beats } from "./songs/utils.js";

// ── Catálogo estático ────────────────────────────────────────────────────────
const SONGS = [demoFiguras, demo34, parabensPraVoce, aEleAGloria];

// ── Músicas importadas (persistidas em localStorage) ─────────────────────────
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
