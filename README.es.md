<div align="center">

<img src="docs/img/banner.png" alt="Architect — Agent Symphony" width="100%" />

# Architect — Agent Symphony

### Un orquestador jerárquico multiagente para el Claude Agent SDK — multiproveedor (Claude + DeepSeek)

*Un solo director. Una compañía de agentes de IA. Tú mantienes el mando.*

[![Sponsor](https://img.shields.io/github/sponsors/SeyhmusKaya?style=for-the-badge&logo=githubsponsors&color=ea4aaa)](https://github.com/sponsors/SeyhmusKaya)
[![Stars](https://img.shields.io/github/stars/SeyhmusKaya/agent-symphony?style=for-the-badge&color=f59e0b)](https://github.com/SeyhmusKaya/agent-symphony/stargazers)
[![Release](https://img.shields.io/github/v/release/SeyhmusKaya/agent-symphony?style=for-the-badge&color=8b5cf6)](https://github.com/SeyhmusKaya/agent-symphony/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/SeyhmusKaya/agent-symphony/ci.yml?branch=main&style=for-the-badge&label=build)](https://github.com/SeyhmusKaya/agent-symphony/actions)
[![Last commit](https://img.shields.io/github/last-commit/SeyhmusKaya/agent-symphony?style=for-the-badge&color=10b981)](https://github.com/SeyhmusKaya/agent-symphony/commits/main)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg?style=for-the-badge)](LICENSE)
[![Built with Claude Agent SDK](https://img.shields.io/badge/Built%20with-Claude%20Agent%20SDK-0F766E?style=for-the-badge)](https://docs.anthropic.com/en/api/agent-sdk)
[![Desktop: Tauri](https://img.shields.io/badge/Desktop-Tauri%20%2B%20SvelteKit-24c8db?style=for-the-badge&logo=tauri)](https://tauri.app)

<br/>

[Türkçe](README.tr.md) · [English](README.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · **Español** · [Português](README.pt.md)

</div>

---

## 💜 Apoyo / Donaciones

**Architect — Agent Symphony es gratuito y de código abierto, creado por un desarrollador en solitario.** Si te ahorra tiempo o simplemente te gusta la idea, una donación mantiene a los agentes en marcha y el desarrollo avanzando. Gracias. 🙏

### ⭐ GitHub Sponsors (recomendado)
La forma más fácil de apoyar — un solo clic, recurrente o puntual, **0 % de comisión de plataforma** (el 100 % llega al autor):

👉 **[github.com/sponsors/SeyhmusKaya](https://github.com/sponsors/SeyhmusKaya)**

### ₿ Cripto

| Activo | Red | Dirección |
|-------|---------|---------|
| **USDT** | **TRC20** (Tron) | `TD5DADsYjH3aydsi7zrgDrqVAj3EzWx1Cb` |
| **BTC** | **Bitcoin** | `12W1kc6qvDEwG9QfdjHWtdT2QEKDrTApWm` |
| **ETH** | **ERC20** (Ethereum) | `0x8d0ba54ba688fe70f1f3888ad494817b9fdebc7b` |

> ⚠️ **Envía cada activo únicamente en la red indicada arriba.** Enviarlo en la red equivocada puede provocar la pérdida permanente de los fondos.

---

## ✨ ¿Qué es esto?

**Architect — Agent Symphony** es una aplicación de escritorio que convierte el Claude Agent SDK en una **organización jerárquica de agentes de IA que orquestas como si fuera una empresa.**

En lugar de chatear con un único asistente, ejecutas un **organigrama de agentes especializados**: un arquitecto principal coordina a los jefes de proyecto, cada jefe comanda a sus propios especialistas persistentes, consulta a un panel de asesores de dominio y despacha trabajadores de un solo uso — todo en paralelo, todo en una misma cabina de mando, con visibilidad total de costes y una gestión de contexto del nivel de Claude Code.

Piénsalo como un **centro de control de misión para un equipo de agentes Claude** — diseñado específicamente para orquestar trabajo de software real y multiproyecto.

### 🧭 Dónde encaja

Si has usado **Claude Code**, **CrewAI**, **AutoGen** o **LangGraph**: esos son frameworks y CLIs que tú *programas*. **Architect — Agent Symphony** es una **cabina de mando de escritorio donde la orquestación *es* el producto** — observas y comandas una organización permanente de agentes a lo largo de proyectos reales, con visibilidad en vivo de costes y contexto, en lugar de escribir código de orquestación. Está construido directamente sobre el **[Claude Agent SDK](https://docs.anthropic.com/en/api/agent-sdk)** oficial (en proceso, sin una CLI aparte), de modo que obtienes un comportamiento del nivel de Claude Code con una interfaz multiagente y multiproyecto por encima.

**Palabras clave:** orquestación de agentes Claude · orquestación de agentes DeepSeek · agentes LLM multiproveedor · IA multiagente · flujos de trabajo agénticos · agentes de codificación autónomos · interfaz alternativa a Claude Code · aplicación de escritorio DeepSeek V4 · equipo de software de IA · herramientas MCP.

---

## 🌟 Qué lo hace diferente

- 🧬 **Habilidades por agente** — cada agente carga sus **propios** archivos de habilidades. Construyes un verdadero especialista con conocimiento profundo del dominio, no un chatbot genérico con una etiqueta de nombre.
- 🤖 **Habilidades asignadas automáticamente según la tarea** — cuando un jefe pone en marcha a un nuevo especialista, este **hereda automáticamente las habilidades de dominio adecuadas** para el trabajo: un especialista en diseño obtiene las habilidades de diseño, uno de seguridad obtiene las habilidades de seguridad.
- 🗂️ **Navega entre proyectos como pestañas del navegador** — cambia entre múltiples **proyectos en vivo y sesiones paralelas** como si fueran pestañas de Chrome, cada uno con sus propios agentes, contexto, historial y medidor de coste.
- 💬 **Los agentes hablan entre sí** — los jefes consultan a los asesores y mensajean a otros jefes de proyecto; el trabajo se *negocia entre agentes*, no solo se dicta de arriba hacia abajo por ti.
- 🌙 **Automejora durante la noche** — el Architect principal puede **analizar su propia base de código cada noche y proponer / desplegar mejoras de forma autónoma**, de modo que el orquestador sigue mejorando mientras duermes.
- ⚡ **Paralelo por defecto** — las subtareas independientes se reparten entre muchos agentes a la vez y luego el director fusiona los resultados.

---

## 📸 La cabina de mando

<div align="center">
<img src="docs/img/app-screenshot.png" alt="Architect — Agent Symphony desktop cockpit" width="100%" />
</div>

---

## 🎼 La Sinfonía — cómo se interpreta la jerarquía

<div align="center">
<img src="docs/img/architecture.png" alt="Architecture: Architect → Project Chiefs → Specialists / Workers, with a panel of Advisors" width="92%" />
</div>

```
                        🏛️  ARCHITECT  (the conductor)
                        coordinates everything, owns the ecosystem
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        │                             │                             │
   👔 PROJECT CHIEF             👔 PROJECT CHIEF              🎓 ADVISORS (11, fixed)
   owns one project            owns another project          domain decision support
   git · ssh · deploy          git · ssh · deploy            design · SEO · security
        │                             │                       legal · finance · data
        ├── 🧑‍💻 Specialist          ├── 🧑‍💻 Specialist        devops · marketing · …
        ├── 🧑‍💻 Specialist          └── ⚡ Worker (one-shot)   (consulted on demand)
        └── ⚡ Worker (one-shot)
```

| Rol | Qué es | Vida útil |
|------|-----------|----------|
| 🏛️ **Architect** | El director. Coordina todo el ecosistema, desarrolla el propio orquestador y enruta el trabajo entre los jefes. | Siempre activo |
| 👔 **Project Chief** | Uno por proyecto. El ingeniero sénior del proyecto — es dueño del código, git, ssh/despliegue. Habla con otros jefes. | Persistente |
| 🧑‍💻 **Specialist** | El experto persistente de un jefe (p. ej. *Especialista de Frontend*, *Especialista de Backend*). Escribe y edita código en una ventana de agente paralela y aislada. | Persistente |
| 🎓 **Advisor** | 11 expertos de dominio fijos (diseño/UI, SEO, seguridad, legal, marketing, finanzas, contabilidad, datos, devops, social, trading). Apoyo a la decisión — no escriben código. | Integrado |
| ⚡ **Worker** | Un agente anónimo de un solo uso para exploración rápida o una sola edición. | Efímero |

Los agentes hablan entre sí (mensajería entre agentes), delegan en paralelo y el director cose los resultados — así das una sola instrucción y todo un equipo la ejecuta.

---

## 🚀 Características

### 🧠 Ingeniería de contexto del nivel de Claude Code
- **Compactación nativa del SDK** — el contexto se compacta *dentro de la misma sesión* (conservando el ID de sesión) tal como lo hace Claude Code, con un mecanismo de respaldo heredado de resumir-y-arrastrar para que un agente **nunca pierda su memoria de trabajo**.
- **Seguimiento de tokens y coste por sesión y por agente** — cada turno muestra los tokens nuevos / de lectura de caché / de escritura de caché y el coste exacto en USD.
- **Diseño consciente de la caché de prompts** — conjuntos de herramientas estables y un diseño de prompt amigable con la caché mantienen altas las tasas de acierto de caché (lecturas baratas en lugar de reescrituras costosas).
- **Grupos de herramientas perezosos** — los agentes cargan conjuntos de herramientas bajo demanda (`load_toolset`) para mantener bajo el mínimo de tokens por turno.

### 🔀 Enrutamiento de modelos multiproveedor (Claude + DeepSeek)
- **Dos proveedores, una sola cabina** — ejecuta agentes en **Anthropic Claude** (Opus / Sonnet / Haiku) **o DeepSeek V4** (`deepseek-v4-pro` / `deepseek-v4-flash`). Elige el modelo por agente desde el mismo menú desplegable.
- **Prioridad automática de proveedor** — si hay configurada una clave de API de DeepSeek, se usa DeepSeek primero; de lo contrario, una clave de API de Anthropic; de lo contrario, tu inicio de sesión de Claude Pro/Max. Sin cambios de código.
- **Valores por defecto sensatos por rol en DeepSeek** — los jefes, el arquitecto principal y los asesores usan por defecto **DeepSeek V4 Pro**, y los especialistas/trabajadores de un solo uso el más económico **DeepSeek V4 Flash**.
- **Cómo funciona** — se accede a DeepSeek a través de su **endpoint compatible con Anthropic** (`https://api.deepseek.com/anthropic`), de modo que el mismo formato de petición del Agent SDK, las llamadas a herramientas, el modo de razonamiento y la ventana de contexto de 1M de tokens funcionan sin cambios. El coste en USD por modelo y por token se rastrea correctamente para cada proveedor.
- **Cambia en vivo** — cambia el modelo de un agente en ejecución de Claude a DeepSeek (o a la inversa) en mitad de la sesión; el enrutamiento sigue al modelo seleccionado en cada petición.

### 🕸️ CodeGraph — inteligencia de código semántica
Un grafo de código integrado sobre tus repos (impulsado por **tree-sitter** para TypeScript, JavaScript, Python, PHP, C#, Dart y Svelte + **SQLite FTS** + embeddings):
- `code_search`, `code_node`, `code_callers`, `code_callees`, `code_impact`, `code_imports`, `code_files`, `code_stats`
- Los agentes consultan el grafo en lugar de hacer grep a ciegas — más rápido, más barato, más preciso. Se reindexa automáticamente ante cambios en los archivos.

### 👥 Orquestación multiagente
- **Delegación en paralelo** — las subtareas independientes se reparten entre múltiples agentes en un solo lote.
- **Especialistas persistentes** con su propia identidad, habilidades e historial de chat.
- **Comunicación entre agentes** — los jefes consultan a los asesores y se mensajean entre sí (`talk_to_chief`).
- **Vista de actividad en vivo** — haz clic en cualquier especialista que esté trabajando para ver el prompt que recibió y lo que está haciendo en este momento.
- **Delegación en segundo plano** — lanza un especialista de larga duración y sigue chateando con el jefe; los resultados regresan cuando están listos.

### 🗂️ Cabina multiproyecto y multisesión
- Gestiona muchos proyectos, cada uno con su propio jefe y agentes.
- Múltiples sesiones paralelas por agente, al estilo de Claude Code, cada una con su propio contexto, coste e historial.
- Las sesiones **nunca se reinician silenciosamente** — tu contexto sobrevive a paradas, reinicios y reintentos.

### 🛠️ Herramientas de operador del mundo real
- Herramientas de **SSH / despliegue** para llevar proyectos a los servidores.
- **Bóveda de secretos** para credenciales (nunca se incluyen en commits).
- **Habilidades por rol** — adjunta archivos SKILL de dominio a especialistas y asesores.
- **Modo autónomo** — entrega a un agente un objetivo de varios días y déjalo trabajar, pausar y reanudar.
- **Automatización de navegador y generación de imágenes** mediante Playwright.
- **Control de presupuesto** con respaldo automático a un modelo más barato cuando se alcanza un tope.

### 🎨 Una aplicación de escritorio realmente agradable
Construida con **Tauri + SvelteKit** — una cabina de escritorio rápida y nativa (no una pestaña del navegador) con una interfaz oscura limpia y de diseño propio: encabezados con degradado, listas de agentes basadas en tarjetas, medidores de tokens en vivo, un explorador de CodeGraph, informes y notas.

---

## 🧩 Pila tecnológica

| Capa | Tecnología |
|-------|------|
| **Agentes** | [Claude Agent SDK](https://docs.anthropic.com/en/api/agent-sdk) (en proceso) |
| **Proveedores de modelos** | Anthropic Claude (Opus / Sonnet / Haiku) · DeepSeek V4 (Pro / Flash) a través del endpoint compatible con Anthropic |
| **Backend** | TypeScript sobre `tsx`, WebSocket (`ws`), Zod |
| **Inteligencia de código** | tree-sitter (7 lenguajes) + `better-sqlite3` (FTS) + embeddings |
| **Automatización** | Playwright / Patchright |
| **Interfaz de escritorio** | Tauri (Rust) + SvelteKit |

---

## 📦 Primeros pasos

> **Estado:** **Usado activamente en producción todos los días** por el autor para ejecutar trabajo de software real y multiproyecto — esto no es una demo ni software abandonado. Hoy funciona en Windows y es software para usuarios avanzados (cuenta con leer algo de código). **Se mantiene activamente y seguirá mejorando — si hay interés, el desarrollo continúa.** Abre un [issue](https://github.com/SeyhmusKaya/agent-symphony/issues) con lo que te gustaría, o conviértete en [sponsor](https://github.com/sponsors/SeyhmusKaya) para ayudar a dar forma a la hoja de ruta.

### Requisitos previos
- **Node.js 20+**
- **Acceso a Claude** — ya sea una **suscripción a Claude Pro / Max** *o* una **clave de API de Anthropic**. Consulta [Autenticación](#-authentication--works-with-your-claude-plan-or-an-api-key) más abajo.
- Para la compilación de escritorio: los [requisitos previos de Tauri](https://tauri.app/start/prerequisites/) (cadena de herramientas de Rust)

### Ejecutar el orquestador (backend)
```bash
git clone https://github.com/SeyhmusKaya/agent-symphony.git
cd agent-symphony
npm install

# copy the secrets template and fill in what you need (optional: ssh/deploy/relay)
cp secrets.local.json.example secrets.local.json

# start the orchestrator
npm start          # or: npm run dev   (tsx watch, auto-reload)
```

### Ejecutar la interfaz de escritorio
```bash
cd ui
npm install
npm run tauri dev   # dev mode
# or: npm run tauri build   # produces a native desktop binary
```

### Comprobación de tipos
```bash
npm run typecheck          # backend
cd ui && npm run check     # UI (svelte-check)
```

---

## 🔑 Autenticación — plan de Claude, clave de Anthropic, *o* clave de DeepSeek

Architect — Agent Symphony se ejecuta sobre el **Claude Agent SDK** oficial y admite **dos proveedores de modelos**. Elige un proveedor en este orden de prioridad:

- 🟣 **Clave de API de DeepSeek** *(máxima prioridad cuando está configurada)* — añade tu clave de DeepSeek en el panel de **claves de API** dentro de la app (almacenada localmente en `providers.json`, nunca se incluye en commits). Los agentes se ejecutan entonces en **DeepSeek V4 Pro / Flash** a través del endpoint de DeepSeek compatible con Anthropic. La vía más económica; los modelos de Claude siguen disponibles en el menú desplegable si además tienes un inicio de sesión de Claude.
- 🟢 **Suscripción a Claude Pro / Max** *(recomendado para usuarios de Claude)* — inicia sesión una vez con la CLI de Claude (`claude login`). El uso se descuenta de tu **cuota Pro/Max existente — sin clave de API, sin factura por token.**
- 🔵 **Clave de API de Anthropic** *(pago por token)* — establece `ANTHROPIC_API_KEY`. Ideal para equipos/automatización con facturación de Console.

> ⚠️ Si `ANTHROPIC_API_KEY` está configurada en tu entorno, **tiene prioridad** sobre tu suscripción de Claude. Para usar tu plan Pro/Max con los modelos de Claude, deja esa variable sin configurar (y ejecuta `claude logout` → `claude login` con la cuenta Pro/Max). La clave de DeepSeek se gestiona por separado dentro de la app y solo afecta a las peticiones a modelos de DeepSeek.

El proxy local de la app solo optimiza la caché de prompts — **nunca toca tus credenciales ni la ruta de refresco de OAuth**, así que ambos modos de autenticación funcionan de inmediato.

---

## ⚙️ Configuración

- **Autenticación** — una clave de DeepSeek (en la app), un inicio de sesión de Claude Pro/Max, *o* `ANTHROPIC_API_KEY` (consulta [Autenticación](#-authentication--claude-plan-anthropic-key-or-deepseek-key)).
- **`secrets.local.json`** — credenciales opcionales de SSH / autenticación web / relay (ignoradas por git, nunca se incluyen en commits). Consulta `secrets.local.json.example`.
- **Banderas de características** (variables de entorno) — activa o desactiva subsistemas opcionales como la caché de prompts de TTL largo, la delegación asíncrona y la compactación nativa.

> Los directorios `.github/`, `.team/` y los de datos en tiempo de ejecución están ignorados por git — nunca se incluyen credenciales ni datos de sesión en los commits.

---

## 🗺️ Hoja de ruta

- Compilaciones de escritorio multiplataforma (macOS / Linux)
- ✅ Proveedores de modelos conectables — **DeepSeek V4 lanzado**; más proveedores en camino
- Controles de modo autónomo más completos
- Más lenguajes en CodeGraph

¿Tienes una idea? [Abre un issue](https://github.com/SeyhmusKaya/agent-symphony/issues) o, si te resulta útil, considera convertirte en [sponsor](https://github.com/sponsors/SeyhmusKaya) 💜.

---

## 📄 Licencia

[MIT](LICENSE) © Şeyhmus Kaya

---

<div align="center">

**Si Architect — Agent Symphony te resulta útil, una ⭐ y un [patrocinio](https://github.com/sponsors/SeyhmusKaya) ayudan muchísimo.**

Hecho con cuidado, dirigido por un solo desarrollador.

</div>
