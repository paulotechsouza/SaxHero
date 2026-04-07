# 🎷 SaxHero

**SaxHero** é um jogo de ritmo rodando no navegador para aprender saxofone. Toque junto com as músicas em tempo real — o jogo ouve o seu saxofone pelo microfone, pontuará sua precisão de afinação e exibe a partitura rolando na tela, no estilo Guitar Hero.

---

## ✨ Funcionalidades

- **Detecção de pitch em tempo real** — Usa o algoritmo de autocorrelação ACF2+ via Web Audio API para detectar a nota tocada com baixa latência.
- **Renderizador de partitura** — Pauta de clave de sol com notas coloridas, colcheias agrupadas (beaming), pausas e fórmula de compasso renderizados em Canvas HTML5.
- **Importação de áudio e extração de melodia** — Importe qualquer arquivo MP3, WAV, OGG, M4A ou FLAC. O app analisa a melodia usando [essentia.js](https://essentia.upf.edu/essentiajs/) (PitchMelodia) com fallback para ACF2+.
- **Afinador cromático** — Afinador integrado na tela de calibração que mostra a nota detectada, frequência e agulha de desvio em cents.
- **Metrônomo** — Metrônomo baseado em Web Audio API com acento no tempo 1, ativável/desativável durante o jogo.
- **Música de fundo** — Toca o áudio original junto ao jogo com volume ajustável.
- **Suporte a múltiplos saxofones** — Transposições para Alto (Mib), Tenor (Sib) e Soprano (Sib) tratadas automaticamente.
- **Pontuação e notas** — Pontuação, % de precisão, multiplicador de combo e nota S/A/B/C/D na tela de resultados.
- **Biblioteca de músicas embutida** — Acompanha músicas pré-construídas definidas como sequências de notas.

---

## 🖥️ Tecnologias

| Camada           | Tecnologia                                                          |
| ---------------- | ------------------------------------------------------------------- |
| Framework        | [React 18](https://react.dev/)                                      |
| Build            | [Vite 5](https://vitejs.dev/)                                       |
| Análise de áudio | [essentia.js](https://essentia.upf.edu/essentiajs/) + Web Audio API |
| Renderização     | HTML5 Canvas (motor 2D customizado)                                 |
| Estilo           | CSS puro                                                            |

---

## 📁 Estrutura do Projeto

```
saxhero/
├── public/                        # Arquivos estáticos
├── src/
│   ├── App.jsx                    # Componente raiz — roteador de telas e estado global
│   ├── screens/
│   │   ├── MenuScreen.jsx         # Seleção de música
│   │   ├── ImportScreen.jsx       # Importação de áudio e extração de melodia
│   │   ├── CalibrationScreen.jsx  # Teste de microfone e afinador cromático
│   │   ├── GameScreen.jsx         # Loop principal de jogo
│   │   └── ResultsScreen.jsx      # Pontuação, precisão e nota final
│   └── lib/
│       ├── GameEngine.js          # Renderizador Canvas + lógica de jogo
│       ├── PitchDetector.js       # Detecção de pitch ACF2+ em tempo real
│       ├── SongImporter.js        # Análise de arquivo de áudio e extração de notas
│       ├── Metronome.js           # Metrônomo via Web Audio API
│       └── songs.js               # Banco de músicas embutidas
├── index.html
├── vite.config.js
└── package.json
```

---

## 🚀 Como Começar

### Pré-requisitos

- [Node.js](https://nodejs.org/) 18 ou superior
- Microfone conectado ao computador
- Navegador moderno com suporte a Web Audio API (Chrome ou Edge recomendado)

### Instalação

```bash
# Clonar o repositório
git clone https://github.com/your-username/saxhero.git
cd saxhero

# Instalar dependências
npm install
```

### Executar em Desenvolvimento

```bash
npm run dev
```

Abra [http://localhost:5173](http://localhost:5173) no seu navegador.

> **Atenção:** O servidor de desenvolvimento exige os cabeçalhos `Cross-Origin-Opener-Policy` e `Cross-Origin-Embedder-Policy` (configurados em `vite.config.js`) para suporte ao `SharedArrayBuffer` usado pelo WASM do essentia.js.

### Build para Produção

```bash
npm run build
npm run preview
```

---

## 🎮 Como Jogar

1. **Menu** — Selecione uma música da lista (ou importe a sua).
2. **Importar** _(opcional)_ — Arraste e solte um arquivo de áudio para extrair a melodia. Use o botão tap-tempo para definir o BPM.
3. **Calibração** — Conceda acesso ao microfone e verifique se o saxofone está sendo detectado corretamente. O afinador cromático mostra a nota e o desvio em cents em tempo real.
4. **Jogo** — A partitura rola da direita para a esquerda. Toque cada nota quando ela cruzar a linha de acerto. Uma contagem regressiva inicia o jogo, e o metrônomo mantém o ritmo.
5. **Resultados** — Veja sua pontuação final, precisão, combo máximo e nota (S → D).

---

## 🎷 Transposições por Saxofone

O SaxHero trata a transposição automaticamente para que as notas escritas na tela correspondam ao que você leria em uma partitura real de saxofone:

| Saxofone      | Transposição |
| ------------- | ------------ |
| Alto (Mib)    | +9 semitons  |
| Tenor (Sib)   | +2 semitons  |
| Soprano (Sib) | +2 semitons  |

---

## 🔑 Sistema de Pontuação

| Evento          | Pontos                        |
| --------------- | ----------------------------- |
| Acerto perfeito | Base × multiplicador de combo |
| Acerto próximo  | Pontos parciais               |
| Erro            | Reset do combo                |

As notas são atribuídas ao final com base na precisão geral:

| Nota | Precisão |
| ---- | -------- |
| S    | ≥ 95%    |
| A    | ≥ 85%    |
| B    | ≥ 70%    |
| C    | ≥ 55%    |
| D    | < 55%    |

---

## 🔒 Permissões do Navegador

O SaxHero requer acesso ao microfone para detectar as notas tocadas. O áudio é processado inteiramente no navegador — **nenhum dado de áudio é enviado a qualquer servidor**.

O aplicativo usa:

- `navigator.mediaDevices.getUserMedia` — captura do microfone
- `AudioContext` / `AnalyserNode` — processamento de sinal em tempo real
- `SharedArrayBuffer` (via WASM do essentia.js) — exige os cabeçalhos COOP/COEP configurados em `vite.config.js`

---

## 📦 Dependências

| Pacote                 | Versão  | Propósito                           |
| ---------------------- | ------- | ----------------------------------- |
| `react`                | ^18.3.1 | Framework de UI                     |
| `react-dom`            | ^18.3.1 | Renderizador DOM                    |
| `essentia.js`          | ^0.1.3  | Extração de melodia de áudio (WASM) |
| `vite`                 | ^5.4.10 | Build e servidor de desenvolvimento |
| `@vitejs/plugin-react` | ^4.3.1  | React Fast Refresh                  |

---

## 📄 Licença

Este projeto é privado. Todos os direitos reservados.
