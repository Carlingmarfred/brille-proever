# Brilleprøver

Lokal prototype der henter hele Synoptiks live-katalog og lægger valgte stel oven på webcam eller et uploadet ansigtsbillede.

## Projektstruktur

- `/index.html` – UI, danske tekster og try-on layout.
- `/styles.css` – styling og responsivt design.
- `/app.js` – app-flow, API-kald, inputhåndtering og rendering.
- `/tryon-core.js` – kerneberegninger for ansigtsmapping, pose og fejlbeskeder.
- `/server.ps1` – lokal server + API-proxy til katalogdata.
- `/tests/tryon-core.test.js` – unit tests for poseberegning og API-fejltekst.
- `/tests/localization.integration.test.js` – integrationstests for dansk lokalisering.

## Installation og kørsel

1. Start serveren fra projektmappen:

```powershell
.\run.cmd
```

eller:

```powershell
powershell -ExecutionPolicy Bypass -File .\server.ps1
```

2. Installer testafhængigheder:

```bash
npm install
```

3. Kør tests:

```bash
npm test
```

Appen prøver `http://localhost:5185` først og falder automatisk tilbage til en ledig lokal port, hvis den er optaget. `run.cmd` åbner browseren på den rigtige URL automatisk.

## Valgte open source-kilder

### Ansigtslandmarks / face tracking

- **MediaPipe Tasks Vision (Face Landmarker)**  
  GitHub: https://github.com/google-ai-edge/mediapipe  
  Valgt fordi den giver hurtig og stabil landmark-detektion i browseren med både CPU/GPU fallback.

### AR-overlay / 3D-lignende rendering

- **MediaPipe Face Landmarker + CSS 3D transforms**  
  GitHub (MediaPipe): https://github.com/google-ai-edge/mediapipe  
  Valgt fordi landmarks kan mappes direkte til realistisk skalering, rotation (X/Y/Z) og perspektiv uden tung native AR-stack.

- **Three.js (anbefalet næste trin)**  
  GitHub: https://github.com/mrdoob/three.js  
  Egnet til senere opgradering til fuld 3D-model af stel, lys og materialer.

## Hvad løsningen kan nu

- Henter hele Synoptiks katalog live via deres Algolia-feed.
- Lokal søgning og sortering på tværs af hele kataloget.
- Viser produktbilleder, pris, farve og stelmål.
- Virtuel prøve oven på uploadet billede eller webcam.
- Autoplacering via ansigtslandmarks.
- Manuel finjustering med scale, rotation, offset og opacitet.

## Forslag til senere forbedringer

- Skift fra 2D-overlay til fulde 3D-stel i Three.js (bedre dybde og realisme).
- Device-specifik optimering til mobil (lavere model-load, adaptiv frame rate).
- Personlig kalibrering pr. bruger (IPD-estimat og gemte præferencer).
- E2E-testflow i browser (fx Playwright) for hele prøveforløbet.
