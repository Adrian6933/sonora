# Sonora

Mezclador de audio por aplicación para Windows. Estilo Astro/SteelSeries Sonar,
pero sin drivers: ligero, en la bandeja del sistema, y con atajos de teclado
para cambiar de modo sin salir del juego.

El plan completo está en [PLAN.md](./PLAN.md).

## Estado

**v0 en construcción** — mezclador por aplicación.

## Stack

- **Tauri 2** — ~12 MB de instalador, ~50 MB de RAM (Electron serían ~300)
- **React 19 + TypeScript + Tailwind 4** — la interfaz
- **Rust + crate `windows`** — Core Audio / WASAPI

## Cómo funciona por dentro

Los objetos COM de Core Audio están atados al hilo que los creó, así que **todo
el acceso al audio vive en un único hilo** (`src-tauri/src/audio/com_thread.rs`)
que recibe órdenes por un canal. Ese mismo hilo aprovecha los huecos entre
órdenes para muestrear los niveles a 20 Hz y emitir el evento `sessions` al
frontend. Al ser un solo hilo, no hay carreras y no hace falta sincronización.

```
src-tauri/src/
├── audio/
│   ├── com.rs          Guard de CoInitializeEx / CoUninitialize
│   ├── com_thread.rs   El hilo dueño de COM + muestreo de niveles
│   ├── sessions.rs     Enumerar sesiones, volumen, mute
│   └── process.rs      PID -> ruta del .exe (con caché)
├── commands.rs         Comandos que ve el frontend
├── lib.rs              Arranque de Tauri
└── bin/poc.rs          Prueba de concepto sin interfaz
```

## Desarrollo

```bash
npm run tauri dev
```

La prueba de concepto en consola, útil para depurar la capa de audio sin UI:

```bash
cd src-tauri
cargo run --bin poc                    # lista las sesiones
cargo run --bin poc -- vol 1234 0.5    # PID 1234 al 50%
cargo run --bin poc -- mute 1234
cargo run --bin poc -- master 0.8
```

## Requisitos

- Node.js 20+
- Rust (rustup)
- Visual Studio Build Tools 2022 con el workload de C++
- WebView2 (ya viene con Windows 11)

## Notas

- **No requiere administrador.**
- **No inyecta código en ningún proceso**, solo usa APIs públicas de audio, así
  que no hay conflicto con anti-cheats. Conviene no romper esto nunca.
