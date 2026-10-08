<p align="center"><img src="brand/wordmark-600.png" alt="League of Agents" width="420"></p>

[English](README.md) · [简体中文](README.zh-CN.md) · [Français](README.fr.md) · [Português (Brasil)](README.pt-BR.md) · [Español](README.es.md)

> Traducción beta, aún no revisada por un hablante nativo. El [README.md](README.md) en inglés es la referencia.

## ¿Qué es League of Agents?

**See every change your agents make.**<br>
Mira cada cambio que hacen tus agentes.

League of Agents es un mapa de tu código donde diriges agentes de código y revisas su trabajo.

Los agentes de código cambian más código del que nadie puede revisar línea por línea. League of Agents muestra tu proyecto como un mapa, y cada cambio que hace un agente aparece en él. Ves qué cambió, dónde y si todo sigue funcionando, y luego lo conservas o lo deshaces.

Se ejecuta en tu computadora, funciona con los agentes que ya usas y es de código abierto.

![Seleccionar una carpeta en el mapa, pedir un cambio a Claude Code y revisar el diff de la ejecución archivo por archivo](docs/media/demo.gif)

## Qué puedes hacer

- **Ve todo tu proyecto de un vistazo.** Sus carpetas y archivos de código en un solo mapa. Aleja para ver la forma, acerca para leer el código.
- **Dirige un agente a líneas exactas.** Selecciona un archivo, una carpeta o unas líneas, y describe el cambio. Con los hooks activados, Claude Code no puede editar fuera de tu selección con sus herramientas de edición. Los hooks están desactivados hasta que digas que sí: el primer `npx leagueofagents-cli@latest` en una terminal pregunta una vez y lo recuerda, y sin terminal siguen desactivados salvo que pases `--hooks`. Para comprobarlo, busca `"hooks": true` en `.loa/bridge.json`. Las ediciones de Codex y Cursor fuera de tu selección se señalan después de la ejecución, y también las de Claude Code cuando los hooks están desactivados o usa un comando de shell.
- **Edita archivos tú mismo.** Haz doble clic en el código de un archivo para abrirlo en el editor. Las ediciones guardadas se registran y se pueden deshacer como cualquier ejecución de un agente.
- **Actualiza lo que depende de un cambio.** Cambia el nombre de una función y pide al agente que actualice todos los archivos que la usan. El diff de tu cambio va en el prompt del agente. El mapa muestra cada archivo que tocó.
- **Revisa antes de conservar.** Cambia entre Antes, Después y Diff, recorre los archivos cambiados, y luego conserva la ejecución o deshazla con un clic.
- **Ejecuta tus comprobaciones automáticamente.** Las pruebas y la comprobación de tipos se ejecutan después de cada ejecución que cambia archivos, para que sepas si todo sigue funcionando.

## Inicio rápido

Abre una terminal en cualquier carpeta de proyecto que sea un repositorio git y elige una opción:

**Deja que tu agente lo configure.** Pega esto en Claude Code, Codex o Cursor:

```text
Read leagueofagents.dev/setup.md and set up League of Agents in this repo.
```

**O ejecútalo tú:**

```bash
npx leagueofagents-cli@latest
```

Qué pasa después:

1. League of Agents se inicia en segundo plano y abre tu repositorio como un mapa en tu navegador.
2. En Chrome, Edge, Brave y Arc, se abre en leagueofagents.dev. El navegador pide una vez dejar que el sitio llegue a tu computadora: elige Permitir. En Safari y Firefox, abre la app local, que no necesita permiso.
3. Selecciona un archivo, describe un cambio y pulsa Enter.

### Requisitos

- macOS. Linux supera todo el conjunto de pruebas, pero aún no se ha probado con un agente real. Windows aún no es compatible.
- git. En un Mac, viene con las herramientas de desarrollo de línea de comandos de Apple: `xcode-select --install`. En Linux, desde tu gestor de paquetes.
- Node 20 o posterior
- Un repositorio git
- Claude Code instalado y con sesión iniciada, para ejecutar agentes desde el mapa. Sin él, los cambios de cualquier editor siguen apareciendo.

## Funciona con

Claude Code, desde el mapa o desde tu terminal. Hermes Agent y DeepSeek Harness, desde el mapa, a través del Agent Client Protocol (Hermes necesita su extra `acp`). Codex y Cursor están en beta. Los cambios de cualquier otro editor o agente aparecen gracias al modo de observación. Cada ejecución muestra el modelo que indicó su agente.

Cualquier otro harness que hable el Agent Client Protocol se puede añadir en tus propios ajustes, nunca en los de un repositorio:

```json
[{ "id": "goose", "name": "Goose", "command": ["goose", "acp"] }]
```

Guárdalo como `~/.config/league-of-agents/agents.json` y reinicia League of Agents. Las claves, los proveedores y los modelos se quedan en los ajustes de cada harness. Hermes pregunta antes de editar, y DeepSeek Harness se ejecuta en su modo de solo lectura, así que también pregunta: una edición fuera de tu selección se rechaza. Un harness añadido que no pregunta tiene esas ediciones señaladas después de la ejecución.

<sub>Creado y probado con Claude Code, Hermes Agent y DeepSeek Harness. La compatibilidad con Codex y Cursor sigue sus formatos publicados y supera pruebas contra ellos, pero aún no se ha verificado del todo con ejecuciones reales.</sub>

## Cómo usarlo

**Desde el mapa.** Selecciona archivos, carpetas o líneas, elige un agente, describe el cambio y pulsa Enter. Cuando termine la ejecución, revísala y consérvala o deshazla. Con una ejecución terminada seleccionada, tu siguiente prompt continúa la misma sesión. Quita el chip "Continuación" para empezar de cero.

Las líneas seleccionadas se identifican por su texto y las líneas de alrededor, no por sus números. Si unas ediciones, un cambio de rama o un rebase mueven el código, la selección lo sigue. Si el código cambió, se eliminó o no se puede distinguir de una copia idéntica, la selección lo indica y no se ejecuta nada hasta que vuelvas a seleccionar. Cuando un agente edita dentro de tu selección, la selección pasa a las líneas nuevas.

Las ediciones hechas durante la ejecución de un agente cuentan en esa ejecución, incluidas las tuyas. Solo hay una ejecución a la vez.

**Desde tu terminal.** Usa Claude Code, Codex o Cursor como siempre. Con los hooks activados, cada prompt que envías se convierte en una ejecución en el mapa, con el prompt como título.

**Desde cualquier editor.** Simplemente trabaja. Cuando los archivos que cambiaste dejan de cambiar durante unos segundos, League of Agents los registra como una ejecución, por ejemplo "main.py editado". Los archivos que git ignora y los archivos nuevos que suelen contener secretos ([listados más abajo](#privacidad-y-seguridad)) nunca se registran, y los cambios de rama y los pulls nunca crean una ejecución.

Un archivo renombrado conserva su lugar en el mapa y aparece como renombrado, con lo que cambió en él. Una carpeta renombrada en bloque también conserva su lugar.

### Comprobaciones

Si tu repositorio no tiene ninguna configurada, League of Agents busca scripts de pruebas y de comprobación de tipos, y pytest, y se ofrece a activarlos. Se guardan en tu carpeta personal, fuera de tu repositorio, salvo que elijas compartirlos con tu equipo en `loa.config.json`. Las comprobaciones que un repositorio incluye en su `loa.config.json` se ofrecen con sus comandos, y solo se ejecutan cuando las activas en tu copia; si la lista cambia, vuelven a esperarte. Una comprobación que no puede ejecutarse en tu computadora, porque falta algo que necesita, aparece como "No se pudo ejecutar" en lugar de fallar, y se puede desactivar con un clic. Consulta [`loa.config.example.json`](loa.config.example.json) para escribir las tuyas.

### Qué escribe en tu computadora

En tu repositorio:

- `.loa/`: los registros de ejecuciones, el puerto y el token del puente, un índice privado de instantáneas, una copia del puente que ejecutan los hooks, el diseño del mapa y un log. Se mantiene fuera de git mediante `.git/info/exclude`, y el puente no se inicia en un repositorio que lo incluya en un commit.
- Instantáneas: commits de git bajo refs privadas `refs/loa/`, guardados en `.git/objects`. Nunca tocan tu rama ni tu área de staging.
- `loa.config.json`, solo si eliges compartir tus comprobaciones con tu equipo.

En tu carpeta personal:

- `~/.config/league-of-agents/repos/`: un archivo por repositorio con las comprobaciones que activaste o aprobaste allí. Está fuera del repositorio, así que nada de lo que contenga un repositorio puede autorizar sus propios comandos.

En la configuración de los agentes, solo después de que digas que sí a los hooks:

- Claude Code: `.claude/settings.local.json` en el repositorio, fuera de git.
- Codex: `.codex/hooks.json` en el repositorio, fuera de git si lo creó League of Agents.

Un archivo de hooks que está en git nunca se edita: los hooks contienen rutas de esta computadora. League of Agents lo indica al iniciarse, y las sesiones de terminal de ese agente no se registran.
- Cursor: `~/.cursor/hooks.json` en tu carpeta personal. Cursor solo lee los hooks del proyecto en la carpeta que abrió, que a menudo está por encima del repositorio.

Tus propios hooks en estos archivos nunca se modifican. Tu navegador también guarda el puerto y el token del puente, y tus preferencias de paneles, tema e idioma, en su propio almacenamiento.

Para quitarlo:

| Qué | Cómo |
|---|---|
| Los hooks, en los tres archivos | `npx leagueofagents-cli@latest hooks remove`. Un archivo que creó League of Agents se elimina; un archivo que ya tenías se deja como estaba. |
| Todo lo que hay en el repositorio: los hooks, `refs/loa/`, `.loa/` y sus líneas en `.git/info/exclude`, y las comprobaciones que autorizaste para él | `npx leagueofagents-cli@latest uninstall` |
| Los objetos de instantáneas en `.git/objects` | Quedan sin referencias después de `uninstall`. Git los elimina por su cuenta pasadas dos semanas, o de inmediato con `git gc --prune=now`. |
| `loa.config.json` | Elimínalo, si lo creaste tú. |
| Lo que guarda tu navegador | Haz clic en Desconectar, o borra los datos del sitio leagueofagents.dev. |

## Qué envía

League of Agents never uploads your code anywhere. Your code goes only to the agent you authorized. League of Agents nunca sube tu código a ningún sitio. Tu código va solo al agente que autorizaste.

- **El puente** solo se comunica con 127.0.0.1: la app en tu navegador y los hooks de tus agentes. No hace ninguna otra petición de red. Ejecuta git en local y nunca hace fetch ni push. Al iniciarse, abre tu navegador en leagueofagents.dev o en la app local, y ejecuta `claude auth status` para ver si Claude Code tiene sesión iniciada.
- **leagueofagents.dev** sirve archivos estáticos: la página, sus scripts, fuentes e imágenes. Se comunica con el puente directamente desde tu navegador, así que tu código, tus prompts y tus ejecuciones solo viajan entre tu navegador y tu computadora. Cuenta las visitas a la página con Vercel Web Analytics: la ruta de la página, sin nada de lo que va después de `?` o `#`; el sitio que enlazó a ella; el país, la región y la ciudad, deducidos de la petición; y el sistema operativo, el navegador y el tipo de dispositivo. Sin cookies. La app que sirve el puente en tu computadora no cuenta nada. Los detalles están en la [página de privacidad](https://leagueofagents.dev/privacy).
- **La instalación** descarga el paquete del registro de npm.
- **Tu agente** recibe tu prompt y una lista de los archivos o líneas seleccionados, como rutas y números de línea. "Actualizar lo que depende de esto" también pone el diff de tu cambio en el prompt. El agente envía lo que lee y lo que recibe a su propio proveedor, según las condiciones de ese proveedor.
- **Tus comprobaciones** ejecutan los comandos que activaste. Lo que hagan depende de ellos.

## Cómo inicia tu agente

Cuando ejecutas un agente desde el mapa, el puente lo inicia en tu repositorio con estos comandos. `<prompt>` es tu prompt con el alcance escrito encima.

| Agente | Comando |
|---|---|
| Claude Code | `claude -p <prompt> --output-format stream-json --verbose --permission-mode acceptEdits` |
| Cursor | `cursor-agent -p --force --output-format stream-json <prompt>` |
| Codex | `codex exec --json --sandbox workspace-write <prompt>` |

Una continuación añade `--resume <session>` para Claude Code y Cursor, y `resume <session>` para Codex. Lo que permite cada opción de permisos:

- **Claude Code, `--permission-mode acceptEdits`:** crea y edita archivos en el repositorio sin preguntar, y **ejecuta allí `mkdir`, `touch`, `rm`, `rmdir`, `mv`, `cp` y `sed` sin preguntar.** Los demás comandos de shell y las peticiones de red necesitan una regla que configures en Claude Code; con `-p` no hay nadie a quien preguntar, así que se deniegan. ([modos de permisos](https://code.claude.com/docs/en/permission-modes#auto-approve-file-edits-with-acceptedits-mode), [ejecuciones no interactivas](https://code.claude.com/docs/en/headless#auto-approve-tools)) El bloqueo del alcance es uno de los hooks, así que solo funciona cuando has dicho que sí a los hooks. Solo comprueba las herramientas de edición de Claude Code. Un cambio hecho con uno de esos comandos de shell no se bloquea; se señala después de la ejecución si está fuera de tu selección.
- **Cursor, `-p --force`:** **ejecuta comandos de shell sin preguntar.** `-p` le da todas las herramientas, incluidas las de escritura y shell, y `--force` permite los comandos salvo que los hayas denegado explícitamente. ([parámetros de la CLI](https://cursor.com/docs/cli/reference/parameters))
- **Codex, `exec --sandbox workspace-write`:** **ejecuta comandos en el repositorio sin preguntar.** Lee y edita archivos y ejecuta comandos dentro del repositorio. El acceso a la red está desactivado, y no puede salir del repositorio. ([modo no interactivo](https://learn.chatgpt.com/docs/non-interactive-mode), [aprobaciones y seguridad](https://learn.chatgpt.com/docs/agent-approvals-security))

## Privacidad y seguridad

League of Agents never uploads your code anywhere. Your code goes only to the agent you authorized. League of Agents nunca sube tu código a ningún sitio. Tu código va solo al agente que autorizaste. Qué envía, y a dónde, está explicado [más arriba](#qué-envía). Quién puede llegar a League of Agents en tu computadora, y cómo está protegido, se explica en [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md). Informa de los problemas de seguridad de forma privada, como explica [SECURITY.md](SECURITY.md).

Las instantáneas excluyen los archivos que git ignora, y cualquier archivo que aún no esté en un commit con uno de estos nombres, en cualquier carpeta: `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `*.kdbx`, `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`, `.npmrc`, `.pypirc`, `.netrc`, `.git-credentials`, `.htpasswd`, `credentials.json`, `secrets.json`, `secrets.yaml`, `secrets.yml`, `service-account*.json`, `*.tfvars`. Esta lista no es completa: un secreto con cualquier otro nombre entra en las instantáneas como cualquier archivo, así que guarda los secretos en archivos que git ignore. Un archivo que ya está en un commit forma parte del historial de tu repositorio, y las instantáneas lo incluyen.

Las instantáneas se quedan en tu computadora salvo que las envíes: `git push`, `git push --all` y `git push --tags` nunca incluyen `refs/loa/`, pero `git push --mirror` envía todas las refs, `refs/loa/` incluidas, y lo mismo ocurre si copias la carpeta `.git`. Ejecuta `uninstall` antes si haces un mirror de un repositorio.

## Límites

- macOS. Linux supera todo el conjunto de pruebas en CI, pero aún no se ha probado con un agente real; allí abre la app local. Windows aún no es compatible.
- No son compatibles las máquinas remotas, SSH ni los dev containers. League of Agents debe ejecutarse en la misma computadora que tu navegador.
- El mapa muestra hasta 1500 archivos de código, y las primeras 400 líneas de cada uno. Los archivos de más de 400 KB no aparecen en el mapa. Los diffs conservan las primeras 4000 líneas de un archivo.
- Los archivos que no son de código, como las imágenes, están en las instantáneas y en el deshacer, pero no en el mapa.
- Los archivos que git ignora y los archivos nuevos que suelen contener secretos nunca se registran.
- Una sola ejecución a la vez en un repositorio.
- Comandos de shell. Hermes los ejecuta sin preguntar, salvo los que considera peligrosos, que League of Agents rechaza. DeepSeek Harness los ejecuta en solo lectura, así que un comando que escribe se rechaza. Todo lo que un comando cambia en el repositorio forma parte de la ejecución: se señala si está fuera de tu selección y se deshace al revertir la ejecución.
- Conserva las 500 ejecuciones más recientes, y todas las ejecuciones de los últimos 30 días. Las ejecuciones más antiguas se eliminan, junto con sus instantáneas.
- El sitio web necesita Chrome, Edge, Brave o Arc. Safari y Firefox usan la app local en su lugar.

## Comandos y opciones

| Comando | Qué hace |
|---|---|
| `npx leagueofagents-cli@latest` | Inicia League of Agents en segundo plano y abre tu navegador |
| `... status` | Muestra si está en marcha, y su enlace |
| `... stop` | Lo detiene |
| `... uninstall` | Quita todo lo que añadió al repositorio |
| `... hooks remove` | Quita solo sus hooks |

| Opción | Valor por defecto | Qué hace |
|---|---|---|
| `--port`, `LOA_PORT` | El primer puerto libre a partir de 43210 | Puerto en el que escucha League of Agents |
| `--web`, `LOA_WEB_URL` | `https://leagueofagents.dev` | Sitio web que se abre en los navegadores de la familia Chrome |
| `--local` | Desactivado | Usa solo la app local, en todos los navegadores: el sitio web nunca se abre y no puede conectarse |
| `--hooks`, `--no-hooks` | Pregunta una vez | Añade u omite los hooks de los agentes sin preguntar |
| `LOA_CLAUDE_BIN` | `claude` | Comando de Claude Code |
| `LOA_CODEX_BIN` | `codex` | Comando de Codex |
| `LOA_CURSOR_BIN` | `cursor-agent` | Comando de Cursor (las instalaciones más nuevas pueden llamarlo `agent`) |

## Para equipos

- **Fija una versión.** `@latest` descarga la versión más reciente cada vez. Para ejecutar la misma versión en todas partes, indícala: `npx leagueofagents-cli@0.1.3`. Las versiones aparecen en [npm](https://www.npmjs.com/package/leagueofagents-cli?activeTab=versions) y en las etiquetas de este repositorio.
- **Un registro interno.** El paquete no tiene dependencias, así que un mirror solo necesita el propio `leagueofagents-cli`: `npx --registry https://npm.example.internal leagueofagents-cli@0.1.3`, o define `registry` en tu `.npmrc`.
- **Sin sitio web.** `--local` usa solo la app que League of Agents sirve en 127.0.0.1, en todos los navegadores, y no deja que se conecte ningún sitio web. No se descarga nada de leagueofagents.dev.
- **Comprobaciones en un repositorio compartido.** Las comprobaciones incluidas en `loa.config.json` solo se ejecutan en una computadora después de que la persona que la usa apruebe esa lista exacta, y de nuevo tras cualquier cambio en ella. Las aprobaciones se guardan en la carpeta personal de cada persona, nunca en el repositorio.
- **Archivos de hooks en git.** Un archivo de hooks que está en git nunca se edita, así que las sesiones de terminal de ese agente no se registran.
- **Qué se queda en cada ordenador.** Las ejecuciones y las instantáneas se guardan por repositorio y por computadora: las 500 ejecuciones más recientes y todas las de los últimos 30 días. Las instantáneas excluyen los archivos que git ignora y los archivos sin seguimiento que suelen contener secretos ([lista](#privacidad-y-seguridad)). `git push --mirror` las enviaría; los push normales nunca lo hacen.

## Cómo funciona

League of Agents tiene dos partes:

- **El puente** (`bridge/loa.mjs`) se ejecuta en tu computadora, dentro de tu repositorio. Node 20 o posterior, sin dependencias. Antes y después de cada ejecución, guarda una instantánea de tus archivos en un commit de git usando un índice privado, así que tu rama y tu área de staging nunca se tocan. Los diffs salen de comparar las dos instantáneas. Deshacer restaura la instantánea de "antes", y pregunta primero si un archivo volvió a cambiar desde entonces.
- **La app** (`web/`, hecha con Vite, React y TypeScript) es el mapa que usas. Se sirve en leagueofagents.dev y desde el propio puente.

Hay más detalles en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Desarrollo

```bash
npm --prefix web ci
npm --prefix web run build
cd ~/code/your-project
node ~/code/league-of-agents/bridge/loa.mjs
```

Para alojar tu propia copia de la app, despliega el repositorio en Vercel (`vercel.json` define la compilación), añade tu dominio e inicia el puente con `--web https://your-domain`.

| Variable | Valor por defecto | Qué hace |
|---|---|---|
| `LOA_WEB_DIR` | `web/dist` | App compilada que sirve el puente |
| `LOA_WEB_FILE` | ninguno | Sirve un único archivo HTML en su lugar |

## Contribuir

Consulta [CONTRIBUTING.md](CONTRIBUTING.md). Las contribuciones se aceptan bajo la Apache License 2.0, y todo el mundo sigue el [código de conducta](CODE_OF_CONDUCT.md).

## Licencia

[Apache 2.0](LICENSE)
