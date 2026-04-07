#!/usr/bin/env node
/**
 * compile-song.js — Compilador de músicas para SaxHero
 *
 * Uso:
 *   node scripts/compile-song.js caminho/para/musica.song
 *
 * Gera automaticamente src/lib/songs/<id>.js e dá instrução para
 * registrar no índice songs.js.
 *
 * ─── FORMATO DO ARQUIVO .song ─────────────────────────────────────────────
 *
 *  # Linhas com # são comentários e são ignoradas
 *
 *  TITULO:     Minha Música
 *  AUTOR:      Fulano
 *  ID:         minha_musica          # identificador único (snake_case)
 *  BPM:        120
 *  COMPASSO:   4/4                   # 3/4, 6/8, 12/8 etc.
 *  SAX:        alto                  # alto | tenor | soprano | concerto
 *  DIFICULDADE: 2                    # 1-5
 *
 *  # ─── Notas ──────────────────────────────────────────────────────────────
 *  # Formato: NOTA:DURAÇÃO  (separados por espaço ou tab)
 *  # NOTA pode ser:
 *  #   - Solfejo:  Do Re Mi Fa Sol La Si  (maiúsculo ou minúsculo)
 *  #   - Inglês:   C D E F G A B
 *  #   - Oitava:   Do4  Re5  C4  A3   (padrão = 4 se omitido)
 *  #   - Acidente: Do#4  Reb4  F#4  Bb3  (# ou b depois da nota)
 *  #   - Pausa:    ---  ou  P  ou  pausa
 *  #
 *  # DURAÇÃO (em semínimas, semínima = 1 tempo):
 *  #   sb  ou  1/1   = semibreve     (4)
 *  #   m   ou  1/2   = mínima        (2)
 *  #   s   ou  1/4   = semínima      (1)
 *  #   c   ou  1/8   = colcheia      (0.5)
 *  #   sc  ou  1/16  = semicolcheia  (0.25)
 *  #   f   ou  1/32  = fusa          (0.125)
 *  #   sf  ou  1/64  = semifusa      (0.0625)
 *  #   Adicione . para aumentar 50% (pontuada): s.  c.  m.  etc.
 *  #   Ou use número decimal diretamente:  Do4:1.5
 *  #
 *  # NOTAS ESCRITAS (SAX ≠ concerto):
 *  #   Por padrão as notas são interpretadas como notas ESCRITAS para o
 *  #   instrumento definido em SAX:. O compilador converte para tom de
 *  #   concerto automaticamente (subtraindo a transposição do sax).
 *  #   Se SAX: concerto, nenhuma conversão é feita.
 *  #
 *  # ─── Exemplo ─────────────────────────────────────────────────────────────
 *  # (para saxofone alto, escreva as notas como você as lê na partitura)
 *
 *  Do4:s  Mi4:s  Sol4:s  La4:s
 *  Si4:m. Sol4:s.
 *  ---:c  Re4:c  Fa4:s  La4:s
 *
 * ──────────────────────────────────────────────────────────────────────────
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Tabelas de conversão ────────────────────────────────────────────────────

const SOLFEJO_TO_EN = {
  do: "C",
  dó: "C",
  re: "D",
  ré: "D",
  mi: "E",
  fa: "F",
  fá: "F",
  sol: "G",
  la: "A",
  lá: "A",
  si: "B",
};

const NOTE_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const DURATION_MAP = {
  // palavra → beats (semínima = 1)
  sb: 4,
  "1/1": 4,
  semibreve: 4,
  m: 2,
  "1/2": 2,
  minima: 2,
  mínima: 2,
  s: 1,
  "1/4": 1,
  seminima: 1,
  semínima: 1,
  c: 0.5,
  "1/8": 0.5,
  colcheia: 0.5,
  sc: 0.25,
  "1/16": 0.25,
  semicolcheia: 0.25,
  f: 0.125,
  "1/32": 0.125,
  fusa: 0.125,
  sf: 0.0625,
  "1/64": 0.0625,
  semifusa: 0.0625,
};

// Transposição: nota escrita → tom de concerto (subtrair esses semitons)
const SAX_WRITTEN_TO_CONCERT = {
  alto: 9, // escrita soa 9 st abaixo: escrita A = concerto C
  tenor: 2,
  soprano: 2,
  concerto: 0,
};

// ── Parser de nome de nota ──────────────────────────────────────────────────

/**
 * Converte string "Do#4", "Reb5", "F#4", "Bb3" etc. para nome de nota
 * no formato padrão do SaxHero (ex.: "C#4", "Bb3").
 * Retorna null para pausas.
 */
function parseNoteName(token) {
  if (/^(---|p|pausa)$/i.test(token)) return null; // pausa

  // Extrai: nome, acidente (#/b), oitava
  const m = token.match(/^([a-záéíóúàèìòùâêîôûãõç]+)(#|b{1,2})?(\d)?$/i);
  if (!m) throw new Error(`Nota inválida: "${token}"`);

  const rawNote = m[1].toLowerCase();
  const accident = m[2] ?? "";
  const octave = m[3] ?? "4";

  // Resolve solfejo → formato inglês
  const enLetter = SOLFEJO_TO_EN[rawNote] ?? rawNote.toUpperCase();
  if (!NOTE_SEMITONES.hasOwnProperty(enLetter)) {
    throw new Error(`Nota não reconhecida: "${rawNote}"`);
  }

  // Normaliza: Bb → Bb, F# → F#
  return `${enLetter}${accident}${octave}`;
}

/**
 * Transpõe uma nota (ex. "A4") por +semitones semitons,
 * retornando no mesmo formato ("C5", "D#4" etc.).
 */
function transposeNote(noteName, semitones) {
  if (semitones === 0) return noteName;

  // Tabela completa de nomes (preferindo sustenidos)
  const NAMES = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
  ];
  // Para bemóis, mapeia nomes enarmônicos
  const FLAT_MAP = {
    Db: "C#",
    Eb: "D#",
    Fb: "E",
    Gb: "F#",
    Ab: "G#",
    Bb: "A#",
    Cb: "B",
  };

  const m = noteName.match(/^([A-G])(#|b{1,2})?(\d)$/);
  if (!m) throw new Error(`Não foi possível transpor: "${noteName}"`);

  const letter = m[1];
  const accident = m[2] ?? "";
  const octave = parseInt(m[3], 10);

  const normalized = FLAT_MAP[letter + accident] ?? letter + accident;
  let idx = NAMES.indexOf(normalized);
  if (idx === -1) idx = NAMES.indexOf(letter); // fallback

  const total = idx + semitones;
  const newOctave = octave + Math.floor(total / 12);
  const newIdx = ((total % 12) + 12) % 12;

  return `${NAMES[newIdx]}${newOctave}`;
}

/**
 * Analisa duração: "s", "c.", "1/8", "1.5", etc.
 * Retorna valor em beats (semínima = 1).
 */
function parseDuration(token) {
  // Pontuação no final
  const dotted = token.endsWith(".");
  const base = dotted ? token.slice(0, -1) : token;

  let val;
  if (/^\d+(\.\d+)?$/.test(base)) {
    val = parseFloat(base);
  } else {
    const low = base.toLowerCase();
    if (!DURATION_MAP.hasOwnProperty(low)) {
      throw new Error(`Duração inválida: "${token}"`);
    }
    val = DURATION_MAP[low];
  }

  return dotted ? val * 1.5 : val;
}

// ── Parser principal ─────────────────────────────────────────────────────────

function parseSongFile(filePath) {
  const src = fs.readFileSync(filePath, "utf8");
  const lines = src.split("\n");

  const meta = {
    titulo: "Sem título",
    autor: "Desconhecido",
    id: null,
    bpm: 120,
    compasso: "4/4",
    sax: "alto",
    dificuldade: 2,
  };
  const rawNotes = []; // { note: "C4"|null, dur: number }

  let inNotes = false;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    // Remove comentários: # no início da linha ou precedido por espaço.
    // NÃO remove # precedido por letra (sustenido, ex.: Fa#4).
    let line = lines[lineNum].replace(/(^|\s)#.*$/, "").trim();
    if (!line) continue;

    // Detecta se é uma linha de metadados (chave: valor)
    const metaMatch = line.match(/^([A-ZÁÉÍÓÚa-záéíóúÇç_]+)\s*:\s*(.+)$/);
    if (metaMatch) {
      const key = metaMatch[1]
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, ""); // remove acentos
      const val = metaMatch[2].trim();
      switch (key) {
        case "titulo":
          meta.titulo = val;
          break;
        case "autor":
          meta.autor = val;
          break;
        case "id":
          meta.id = val;
          break;
        case "bpm":
          meta.bpm = parseInt(val, 10);
          break;
        case "compasso":
          meta.compasso = val;
          break;
        case "sax":
          meta.sax = val.toLowerCase();
          break;
        case "dificuldade":
          meta.dificuldade = parseInt(val, 10);
          break;
      }
      continue;
    }

    // Linha de notas: tokens separados por espaço/tab
    const tokens = line.split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      const [notePart, durPart] = token.split(":");
      if (!durPart) {
        throw new Error(
          `Linha ${lineNum + 1}: token "${token}" sem duração. Use formato NOTA:DURAÇÃO`,
        );
      }
      const noteName = parseNoteName(notePart);
      const duration = parseDuration(durPart);
      rawNotes.push({ note: noteName, dur: duration });
    }
  }

  if (!meta.id) {
    meta.id = path
      .basename(filePath, path.extname(filePath))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_");
  }

  return { meta, rawNotes };
}

// ── Construção das notas com beatStart ──────────────────────────────────────

function buildNotes(rawNotes, transposeSemitones) {
  const result = [];
  let beat = 0;
  for (const { note, dur } of rawNotes) {
    if (note !== null) {
      const concertNote = transposeNote(note, -transposeSemitones);
      result.push([concertNote, beat, dur]);
    }
    beat += dur;
  }
  return result;
}

// ── Geração do arquivo JS ────────────────────────────────────────────────────

function generateJS(meta, notes) {
  const [num, den] = meta.compasso.split("/").map(Number);
  const id = meta.id;
  const exportName = id.replace(/_([a-z])/g, (_, c) => c.toUpperCase()); // camelCase

  const noteLines = notes
    .map(([n, b, d]) => `  ["${n}", ${b}, ${d}],`)
    .join("\n");

  return `/**
 * ${meta.titulo}
 * ${meta.autor} — BPM ${meta.bpm} — Dificuldade ${meta.dificuldade}
 *
 * Gerado automaticamente por scripts/compile-song.js
 * Arquivo fonte: (edite o .song, não este arquivo)
 */
import { beats } from "./utils.js";

const _notes = [
${noteLines}
];

export const ${exportName} = {
  id: "${id}",
  title: "${meta.titulo}",
  author: "${meta.autor}",
  difficulty: ${meta.dificuldade},
  bpm: ${meta.bpm},
  timeSignature: { numerator: ${num}, denominator: ${den} },
  notes: beats(_notes, ${meta.bpm}),
};
`;
}

// ── Ponto de entrada ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Uso: node scripts/compile-song.js <arquivo.song> [--dry-run]");
  process.exit(1);
}

const inputFile = path.resolve(args[0]);
const dryRun = args.includes("--dry-run");

if (!fs.existsSync(inputFile)) {
  console.error(`Arquivo não encontrado: ${inputFile}`);
  process.exit(1);
}

try {
  const { meta, rawNotes } = parseSongFile(inputFile);
  const semitones = SAX_WRITTEN_TO_CONCERT[meta.sax] ?? 0;
  const notes = buildNotes(rawNotes, semitones);

  console.log(`\n✔ Parsing concluído:`);
  console.log(`  Título:     ${meta.titulo}`);
  console.log(`  ID:         ${meta.id}`);
  console.log(`  BPM:        ${meta.bpm}`);
  console.log(`  Compasso:   ${meta.compasso}`);
  console.log(
    `  Sax:        ${meta.sax} (transposição: -${semitones} semitons)`,
  );
  console.log(
    `  Notas:      ${notes.length} (${rawNotes.length - notes.length} pausas)`,
  );

  const js = generateJS(meta, notes);

  if (dryRun) {
    console.log("\n── Saída (dry-run) ──────────────────────────────────────");
    console.log(js);
  } else {
    const outDir = path.join(ROOT, "src", "lib", "songs");
    const outFile = path.join(outDir, `${meta.id}.js`);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outFile, js, "utf8");
    console.log(`\n✔ Arquivo gerado: src/lib/songs/${meta.id}.js`);
    console.log("\n  Adicione ao catálogo em src/lib/songs.js:");

    const exportName = meta.id.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    console.log(`    import { ${exportName} } from './songs/${meta.id}.js';`);
    console.log(`    // e adicione "${exportName}" ao array SONGS`);
  }
} catch (err) {
  console.error(`\n✗ Erro: ${err.message}`);
  process.exit(1);
}
