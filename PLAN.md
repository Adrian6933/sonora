# Sonora — Plan de proyecto

> Mezclador de audio por aplicación para Windows, con modos, ducking inteligente y atajos globales.
> Estilo Astro/SteelSeries Sonar, pero sin drivers, ligero y bonito.

**Estado:** planificación
**Fecha:** 7 septiembre 2026
**Stack decidido:** Tauri 2 + React + TypeScript + Tailwind + Rust (`windows` crate)

---

## 1. Qué es y qué no es

### La idea
Cuando juegas, quieres que la voz de tus amigos se oiga por encima del juego. Cuando ves una peli, quieres lo contrario. Hoy eso se hace a mano en el mezclador feo de Windows, app por app, cada vez.

Sonora convierte eso en **un atajo de teclado**.

### Alcance realista (importante)
Sonar de SteelSeries instala **drivers de audio virtuales en modo kernel**. Por eso tiene canales "Game / Chat / Media / Aux" como dispositivos separados del sistema. Eso exige un certificado EV + firma WHQL de Microsoft: cientos de euros al año y un proceso de semanas.

**No vamos por ahí.** Todo lo que hace falta para el 90% del valor se consigue con las APIs de Core Audio en espacio de usuario:

| Funcionalidad | Cómo | Viable |
|---|---|---|
| Volumen por aplicación | `ISimpleAudioVolume` | Trivial |
| Detectar qué apps suenan ahora | `IAudioSessionManager2` | Trivial |
| Medidor de nivel en vivo | `IAudioMeterInformation` | Trivial |
| **Ducking** (bajar juego al hablar) | combinación de las dos anteriores | Fácil |
| Silenciar app concreta | `ISimpleAudioVolume::SetMute` | Trivial |
| Cambiar dispositivo de salida de una app | `IAudioPolicyConfig` (no documentada) | Con riesgo |
| Canales virtuales reales | driver kernel | **No** — se delega en VoiceMeeter/VB-Cable si alguien lo quiere |

**Nada requiere permisos de administrador.** No inyectamos código en ningún proceso, así que **no hay problema con anti-cheats** (Vanguard, EAC, BattlEye). Esto es importante y conviene no romperlo nunca: si algún día se plantea un overlay in-game real, se replantea todo desde cero.

---

## 2. Por qué Tauri y no otra cosa

- La app **vive en la bandeja del sistema mientras juegas**. Los ~300 MB de RAM de Electron son justo lo que no queremos pagar con un juego corriendo. Tauri se queda en ~50 MB.
- Queremos que se vea **elegante de verdad**, y eso se consigue con Tailwind + Framer Motion en una tarde. En XAML costaría semanas.
- Rust habla directo con COM vía el crate `windows` (oficial de Microsoft). Sin procesos intermedios ni addons de C++.
- Instalador de ~12 MB porque el motor web (WebView2) ya viene con Windows.

**Coste de la decisión:** hay que escribir COM en Rust, que es verboso. Queda **aislado en un módulo** (`src-tauri/src/audio/`), unas 400-600 líneas. Una vez funciona, no se toca más y el resto del proyecto es React.

**Plan B:** si Rust bloquea el avance más de lo tolerable, `.NET 9 + Avalonia + NAudio` es una retirada digna. Se pierde React, se gana facilidad en el audio.

**Referencia de oro:** EarTrumpet (github.com/File-New-Project/EarTrumpet) es open source en C#/WPF y hace el volumen por app en Windows. Cuando una API de audio no esté clara, la respuesta está en su código.

---

## 3. Arquitectura

```
┌─────────────────────────────────────────────┐
│  FRONTEND · React + TS + Tailwind           │
│  UI, modos, editor de atajos, animaciones   │
└────────────┬────────────────────────────────┘
             │ IPC (comandos + eventos)
┌────────────▼────────────────────────────────┐
│  BACKEND · Rust                             │
│  ┌────────────┐ ┌──────────┐ ┌───────────┐  │
│  │ audio/     │ │ engine/  │ │ system/   │  │
│  │ COM/WASAPI │ │ ducking  │ │ hotkeys   │  │
│  │ sesiones   │ │ modos    │ │ bandeja   │  │
│  │ medidores  │ │ reglas   │ │ autostart │  │
│  └────────────┘ └──────────┘ └───────────┘  │
└─────────────────────────────────────────────┘
```

### Los tres hilos del backend

1. **Hilo COM** — dueño de todos los objetos COM (no son thread-safe). Recibe órdenes por canal y las ejecuta. Todo el acceso al audio pasa por aquí.
2. **Hilo de medidores** — a 30 Hz lee el pico de cada sesión y emite un evento al frontend. 30 Hz es suficiente para que las barras se vean fluidas sin quemar CPU.
3. **Hilo del motor de ducking** — a 60 Hz evalúa las reglas activas y aplica rampas de volumen. Va aparte porque necesita ser más regular que la UI.

### Comandos IPC (frontend → Rust)

| Comando | Qué hace |
|---|---|
| `list_sessions` | Devuelve apps sonando: pid, nombre, ruta, icono, volumen, mute |
| `set_app_volume(pid, vol)` | Cambia volumen de una app |
| `set_app_mute(pid, bool)` | Silencia/desilencia |
| `list_devices` | Dispositivos de entrada y salida |
| `set_default_device(id)` | Cambia el dispositivo por defecto |
| `apply_mode(mode_id)` | Aplica un modo completo |
| `save_mode(mode)` / `delete_mode(id)` | CRUD de modos |
| `register_hotkey(action, combo)` | Registra atajo global |
| `set_settings(settings)` | Preferencias generales |

### Eventos (Rust → frontend)

| Evento | Cuándo |
|---|---|
| `sessions-changed` | Una app empieza o deja de emitir audio |
| `meters` | 30 veces/s, con los picos de todas las sesiones |
| `volume-changed` | Alguien cambió el volumen desde fuera (mezclador de Windows) |
| `mode-applied` | Se activó un modo (por atajo, por auto-switch o manual) |
| `devices-changed` | Se conectó/desconectó un dispositivo |
| `ducking-state` | El ducking se activó o se soltó (para animar la UI) |

---

## 4. APIs de Windows exactas

Todas viven en el crate `windows` con estas features:
`Win32_Media_Audio`, `Win32_Media_Audio_Endpoints`, `Win32_System_Com`, `Win32_Devices_FunctionDiscovery`, `Win32_System_Threading`, `Win32_UI_Shell`.

| Necesidad | Interfaz / función |
|---|---|
| Enumerar dispositivos | `IMMDeviceEnumerator` |
| Enterarse de cambios de dispositivo | `IMMNotificationClient` |
| Enumerar sesiones de audio | `IAudioSessionManager2::GetSessionEnumerator` |
| PID de una sesión | `IAudioSessionControl2::GetProcessId` |
| Ruta del ejecutable | `OpenProcess` + `QueryFullProcessImageNameW` |
| Icono de la app | `SHGetFileInfoW` → `HICON` → PNG en base64 |
| Volumen / mute por app | `ISimpleAudioVolume` |
| Nivel de audio en vivo | `IAudioMeterInformation::GetPeakValue` |
| Avisos de sesión nueva | `IAudioSessionNotification` |
| Avisos de cambio de volumen | `IAudioSessionEvents` |
| Volumen del dispositivo | `IAudioEndpointVolume` |
| Ruta por app a otro dispositivo | `IAudioPolicyConfig` (**no documentada**, ver riesgos) |

### Plugins de Tauri que hacen falta

`global-shortcut` · `autostart` · `store` (persistencia JSON) · `single-instance` · `updater` · `notification` · `os` · `log`

---

## 5. Modelo de datos

```ts
type Mode = {
  id: string
  name: string              // "Competitivo"
  icon: string              // emoji o nombre de icono
  accent: string            // color del modo, tiñe la UI al activarse
  hotkey: string | null     // "Ctrl+Alt+1"

  rules: AppRule[]          // volúmenes por app
  fallbackVolume: number    // para apps no listadas
  outputDevice?: string     // fuerza un dispositivo al activar
  inputDevice?: string

  ducking: {
    enabled: boolean
    trigger: string[]       // ["Discord.exe", "TeamSpeak.exe"]
    targets: string[] | '*' // qué baja; '*' = todo lo demás
    threshold: number       // 0-1, a partir de qué pico dispara
    reduction: number       // 0-1, cuánto baja (0.4 = al 40%)
    attackMs: number        // rapidez de bajada (típico 60)
    releaseMs: number       // rapidez de subida (típico 400)
    holdMs: number          // aguanta bajado tras el silencio (250)
  }

  autoActivate: {
    processes: string[]     // ["VALORANT.exe"] → se activa solo
    devices: string[]       // al conectar estos auriculares
    schedule?: { from: string, to: string }  // "23:00" → "08:00"
  }
}

type AppRule = {
  match: string       // "Discord.exe" o "*chrome*"
  volume: number      // 0-1
  muted: boolean
  device?: string     // fase 4
  priority: number    // 0 = normal, 1 = protegida del ducking
}
```

Todo se guarda en `%APPDATA%/sonora/config.json` vía `tauri-plugin-store`. **Sin nube, sin cuenta, sin telemetría.**

---

## 6. Funcionalidades por fase

### v0 — El mezclador (la base)
- [x] **Prueba de concepto en Rust**: leer y escribir el audio de Windows sin UI (`cargo run --bin poc`) — verificado el 7 sep 2026 contra Discord, Spotify, Chrome, Steam y Riot Client
- [x] Lista de apps que están sonando ahora mismo, en vivo
- [x] Slider de volumen por app, con respuesta instantánea
- [x] Botón de mute por app
- [x] Medidor de nivel animado junto a cada slider
- [x] Volumen maestro
- [ ] **Agrupar varias sesiones de la misma app.** Hallazgo de la prueba: Discord aparece con dos PIDs distintos, y Steam con `Steam.exe` + `steamwebhelper.exe`. Chrome hará lo mismo con cada pestaña. Hay que agrupar por ejecutable y que el slider mande sobre todas las sesiones del grupo a la vez, o el mezclador será un desastre
- [x] Icono real de cada app extraído del `.exe` (con placeholder de inicial para procesos protegidos)
- [x] Sincronización bidireccional: sale gratis del muestreo a 20 Hz — lo que se cambie desde el mezclador de Windows aparece en la UI en 50 ms
- [x] Diseño terminado desde el minuto uno — no "ya lo maquetaré luego"
- [ ] ~~Selector de dispositivo de salida~~ → **movido a v4**. Windows no expone ninguna API pública para cambiar el dispositivo de salida por defecto; hace falta `IPolicyConfig`, que no está documentada (es lo que usan SoundSwitch y compañía). Mismo riesgo que el enrutado por app, así que va con ello

### v1 — Modos y atajos (el corazón)
- [x] Modos predefinidos: **Competitivo · Cine · Música · Stream · Noche**
- [x] Editor visual de modos: creas el tuyo desde cero, le pones nombre, icono y color
- [x] Botón «Guardar niveles actuales»: ajustas el mezclador a mano y lo congelas como modo. Es mucho mejor que teclear reglas
- [x] Persistencia en `%APPDATA%/com.sonora.app/sonora.json`
- [x] El acento del modo tiñe la aplicación entera al activarlo
- [x] **Atajos globales** funcionando con el juego en primer plano:
  - [x] Activar un modo concreto (`Ctrl+Alt+1..5` de fábrica)
  - [x] Ciclar entre modos — con `Ctrl+Alt+0`, configurable. **No se puede usar `Ctrl+Alt+Tab`**: Windows se lo queda para la vista de tareas y el registro falla
  - [ ] Mute del micro (`Ctrl+Alt+M`) — necesita soporte de dispositivos de captura
  - [ ] Subir/bajar volumen de una app concreta sin tocar el resto
  - [ ] Activar/desactivar ducking al vuelo (llega con v2)
- [x] **Grabador de atajos** en la UI: pulsas la combinación y se registra. Avisa cuando otro programa ya la tiene cogida
- [x] Icono en bandeja; cerrar la ventana esconde en vez de matar el proceso
- [x] Arranque con Windows, opcional y minimizado. Se lanza con `--minimized` y se queda solo en la bandeja: abrir una ventana en cada inicio de sesión sería justo lo contrario de lo que quiere quien activa eso
- [x] **Aviso al cambiar de modo.** Es una VENTANA APARTE (`hud`), no un toast dentro de la app, porque el momento en que hace falta es justamente con la ventana principal escondida y un juego delante. Sin bordes, siempre encima, con los clics atravesándola para no comerse un disparo en mitad de una partida
- [ ] Menú de cambio rápido de modo desde la bandeja (el menú es nativo, así que los modos tienen que viajar de JS a Rust)

### v2 — Ducking inteligente (lo que lo hace especial)
- [x] Motor de sidechain: detecta pico en las apps de voz → baja las demás
- [x] Curvas con attack / release / hold configurables — nada de cortes secos
- [x] **Rampa lineal, no exponencial.** Con una exponencial (`gain += (target-gain) * dt/ramp`) el recorrido completo tarda mucho más que `ramp_ms`, así que "400 ms de release" no significaría nada para quien lo configura. Verificado contra audio real: ahora la vuelta tarda los 400 ms que dice
- [x] **El volumen vuelve al valor exacto.** Bug encontrado probando con audio real: al llegar la ganancia a 1.0 el motor dejaba de escribir, la app se quedaba en el último valor de la rampa (97%) y ese valor pasaba a ser la nueva base — cada ciclo de ducking dejaba el volumen un poco más bajo, para siempre. Hay test de regresión (`el_volumen_no_va_bajando_ciclo_a_ciclo`)
- [x] El disparador nunca se atenúa a sí mismo
- [x] Se deshace la atenuación al salir por la bandeja, para no dejar apps al 40% sin nadie que las suba
- [x] Visualización en vivo: indicador con el % de atenuación mientras alguien habla
- [x] Preajustes de agresividad: Suave / Normal / Agresivo
- [ ] Apps "protegidas" que nunca bajan (el campo `targets` ya existe en el motor, falta la UI)
- [ ] Modo inverso: "prioriza el juego" — baja Discord cuando el juego pega un pico fuerte
- [ ] El `hold` por defecto (350 ms) se eligió a ojo con un wav en bucle; conviene afinarlo con voz real

### v3 — Automatización (que no tengas que tocar nada)
- [x] **Auto-switch por proceso**: se abre `VALORANT.exe` → entra el modo Competitivo. Se cierra → vuelve al anterior. Vigilante en Rust con `CreateToolhelp32Snapshot`, sondeo cada 2 s, y solo avisa al frontend de los ejecutables que alguien pidió vigilar (mandar los ~105 procesos abiertos cada dos segundos no tendría sentido)
- [x] **Auto-switch por horario**: a partir de las 23:00, modo Noche automáticamente. Soporta cruzar la medianoche
- [x] **La automatización actúa solo en los CAMBIOS del disparador**, nunca de forma continua. Si actuase continuamente, elegir un modo a mano con el juego abierto sería imposible: al segundo siguiente lo pisaría
- [x] **Abrir Sonora no cambia nada.** El primer aviso del vigilante y la primera comprobación horaria solo toman nota. Sin eso, arrancar con el juego ya abierto contaría como "acaba de empezar" y te reordenaría el mezclador nada más abrir la app
- [x] Un proceso manda sobre el horario: si juegas a las 23:00, el modo del juego pesa más que el modo Noche
- [x] **Auto-switch por dispositivo**: te pones los cascos → modo Juego. Windows ya cambia el dispositivo por defecto solo al conectarlos; nosotros solo tenemos que **detectarlo**, así que no hace falta ninguna API no documentada. Enumeración con `IPropertyStore` + `PKEY_Device_FriendlyName`, leyendo el `PROPVARIANT` con `PropVariantToStringAlloc` para no hurgar en la unión a mano
- [x] El nombre del dispositivo activo se ve en la cabecera del mezclador
- [ ] Modo Noche con reducción de picos, para no despertar a nadie
- [ ] Reglas personalizadas del tipo "si X suena más de Y, haz Z"
- [ ] Perfiles por dispositivo: cada auricular recuerda sus propios niveles

### v4 — Avanzado
- [ ] **Enrutado por app**: manda Spotify a los altavoces y el juego a los cascos (API no documentada, ver riesgos)
- [ ] Control del micrófono: volumen, mute global, indicador visual de mute siempre visible
- [ ] Detección de "micro abierto sin querer" — aviso si llevas 30 min hablando en mute, o al revés
- [ ] Integración con VoiceMeeter para quien quiera canales virtuales reales
- [ ] Enganche con Equalizer APO si está instalado, para ecualización por modo

### v5 — Detalles que enamoran
- [ ] **Mini-modo**: widget compacto siempre visible, arrastrable, semitransparente
- [ ] Panel flotante que aparece con un atajo y desaparece solo tras 3 s (usable en juegos en ventana sin bordes)
- [x] **Importar/exportar modos** en JSON por el portapapeles — compartes tu setup con tus colegas por Discord. Al pegar se valida la forma antes de tocar nada: en el portapapeles puede haber cualquier cosa
- [ ] Importar/exportar como fichero (necesita el plugin de diálogos)
- [ ] Temas visuales y color de acento personalizable
- [ ] Estadísticas: qué apps suenan más, cuánto tiempo en cada modo, cuánto se activa el ducking
- [ ] Búsqueda rápida estilo command palette (`Ctrl+K`) para saltar a cualquier app o modo
- [ ] Español e inglés
- [ ] Auto-actualizador
- [ ] Animación de bienvenida la primera vez, con detección automática de tu setup

---

## 7. Dirección de diseño

Que no parezca "utilidad de Windows". Que parezca producto.

- **Base:** oscuro profundo (`#0A0A0C`), superficies elevadas con transparencia y `backdrop-blur`
- **Acento:** definido por el modo activo. Al cambiar de modo, **toda la UI se tiñe** con una transición de 400 ms. Es el gesto visual característico de la app
- **Tipografía:** Geist o Inter. Números tabulares en los medidores para que no bailen
- **Movimiento:** Framer Motion. Los sliders con `spring`, los medidores con interpolación suave, nunca saltos bruscos
- **Densidad:** generosa. Aire. No amontonar 15 sliders en 400 px
- **Componentes:** Radix UI como base (accesible y sin estilos) + Tailwind encima
- **Ventana:** sin barra de título nativa, decoración propia, esquinas redondeadas, sombra
- **Detalle:** los medidores no son barras planas — degradado que vira a ámbar cerca del clipping

---

## 8. Estructura de carpetas

```
sonora/
├── PLAN.md
├── src/                          # React
│   ├── components/
│   │   ├── mixer/                # AppRow, VolumeSlider, LevelMeter
│   │   ├── modes/                # ModeCard, ModeEditor, ModeSwitcher
│   │   ├── hotkeys/              # HotkeyRecorder, HotkeyList
│   │   └── ui/                   # primitivas sobre Radix
│   ├── hooks/
│   │   ├── useSessions.ts        # suscripción a sessions-changed
│   │   ├── useMeters.ts          # suscripción a meters, 30 Hz
│   │   └── useModes.ts
│   ├── store/                    # Zustand
│   ├── lib/ipc.ts                # wrapper tipado de invoke()
│   └── styles/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── audio/
│   │   │   ├── mod.rs
│   │   │   ├── com_thread.rs     # dueño de COM, recibe órdenes
│   │   │   ├── sessions.rs       # enumerar y controlar sesiones
│   │   │   ├── devices.rs        # dispositivos
│   │   │   ├── meters.rs         # hilo de medidores a 30 Hz
│   │   │   └── icons.rs          # HICON → PNG base64
│   │   ├── engine/
│   │   │   ├── ducking.rs        # bucle a 60 Hz, rampas
│   │   │   ├── modes.rs          # aplicar modos
│   │   │   └── automation.rs     # auto-switch
│   │   ├── system/
│   │   │   ├── hotkeys.rs
│   │   │   ├── tray.rs
│   │   │   └── watcher.rs        # vigila procesos abiertos
│   │   └── commands.rs           # todos los #[tauri::command]
│   ├── Cargo.toml
│   └── tauri.conf.json
└── package.json
```

---

## 9. Riesgos y cómo los toreamos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| `IAudioPolicyConfig` no está documentada y cambió entre versiones de Windows 11 | Alta | Es de fase 4 y **opcional**. La app funciona entera sin ella. Detectar la versión de Windows y esconder la función si no está disponible, nunca crashear |
| COM en Rust es verboso y propenso a fallos de `unsafe` | Media | Todo COM en un solo hilo con dueño único. Envolver cada interfaz en un tipo seguro. Escribir esta capa primero y a fondo |
| Los atajos globales chocan con los de juegos u otras apps | Media | Detectar el fallo de registro y avisar en la UI. Sugerir combinaciones libres |
| Fugas de memoria por referencias COM mal liberadas | Media | El crate `windows` gestiona `AddRef`/`Release` por RAII. Probar sesiones largas de 8 h |
| El polling de medidores consume CPU | Baja | 30 Hz y pausar del todo cuando la ventana está oculta. Objetivo: < 0.5% de CPU en bandeja |
| Falso positivo de antivirus por controlar audio de otros procesos | Baja | Firmar el instalador cuando haya presupuesto. Mientras, documentarlo |
| Anti-cheat | **Nula si no la cagamos** | Jamás inyectar código ni hookear procesos de juego. Solo APIs públicas de audio |

---

## 10. Orden de ataque

El orden importa. **Se empieza por lo que puede matar el proyecto**, no por lo divertido.

1. **Prueba de concepto en Rust puro** (sin UI): un binario que lista las sesiones de audio y cambia el volumen de una. Si esto sale en un rato, el proyecto es viable. Si se atasca, se evalúa el plan B antes de invertir más.
2. Scaffold de Tauri + React + Tailwind, con la ventana sin decorar y el diseño base.
3. Conectar 1 y 2: mezclador funcionando end-to-end (v0).
4. Medidores en vivo y pulido visual.
5. Modos + persistencia.
6. Atajos globales + bandeja.
7. Motor de ducking.
8. Automatización.
9. Lo demás por orden de apetencia.

---

## 11. Modelo por tarea

| Tarea | Modelo | Por qué |
|---|---|---|
| Capa COM/WASAPI en Rust | **Opus** | `unsafe`, COM y gestión de hilos: aquí un error es un crash difícil de depurar |
| Motor de ducking (curvas, timing) | **Opus** | Lógica temporal delicada, hay que razonarla bien |
| Arquitectura e IPC | **Opus** | Decisiones que luego cuesta cambiar |
| Componentes React y maquetación | **Sonnet** | Volumen de código conocido, patrones claros |
| Estilos, animaciones, pulido visual | **Sonnet** | Iteración rápida, mucho ensayo y error |
| Textos, traducciones, documentación | **Sonnet** | |
| Depurar un crash de COM | **Opus** | |

---

## 12. Prerrequisitos de tu máquina

```
Node.js 20+          (ya lo tienes)
Rust (rustup)        https://rustup.rs
Visual Studio Build Tools 2022 con "Desarrollo de escritorio con C++"
WebView2             (ya viene en Windows 11)
```

Lo único que probablemente te falte son las Build Tools de C++ (Rust las necesita para enlazar en Windows) y Rust.

---

## 13. Decisiones pendientes

- [ ] Nombre definitivo — "Sonora" es provisional
- [ ] ¿Open source en GitHub o cerrado?
- [ ] ¿Gratis, de pago o gratis con versión pro?
- [ ] ¿Merece la pena el certificado de firma de código (~200-400 €/año) para evitar el aviso de SmartScreen?
