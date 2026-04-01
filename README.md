# Brilleproever

Lokal prototype der henter hele Synoptiks live katalog og laegger valgte stel oven paa webcam eller et uploadet ansigtsbillede.

## Start projektet

Koer en af disse fra projektmappen:

```powershell
.\run.cmd
```

eller:

```powershell
powershell -ExecutionPolicy Bypass -File .\server.ps1
```

Appen proever `http://localhost:5185` foerst og falder automatisk tilbage til en ledig lokal port, hvis den er optaget. `run.cmd` aabner browseren paa den rigtige URL automatisk.

## Hvad den kan

- Henter hele Synoptiks katalog live via deres Algolia-feed.
- Lokal soegning og sortering paa tvaers af hele kataloget.
- Viser produktbilleder, pris, farve og stelmaal.
- Virtuel proeve oven paa uploadet billede eller webcam.
- Autoplacering via MediaPipe face landmarks.
- Manuel finjustering med scale, rotation, offset og opacity.

## Bemaerk

- Projektet bruger eksterne ressourcer ved runtime:
  - Synoptiks katalogfeed.
  - MediaPipe model fra CDN.
  - Google Fonts.
- Hvis et produktbillede ikke har en perfekt "noshad" variant, falder overlayet tilbage til Synoptiks frontbillede.
