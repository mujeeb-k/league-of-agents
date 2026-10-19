<p align="center"><img src="brand/wordmark-600.png" alt="League of Agents" width="420"></p>

[English](README.md) · [简体中文](README.zh-CN.md) · [Français](README.fr.md) · [Português (Brasil)](README.pt-BR.md) · [Español](README.es.md)

> Traducción beta, aún no revisada por un hablante nativo. El [README.md](README.md) en inglés es la referencia.

## ¿Qué es League of Agents?

**See every change your agents make.**<br>
Mira cada cambio que hacen tus agentes.

League of Agents es un mapa de tu código donde diriges agentes de código y revisas su trabajo.

Los agentes de código cambian más código del que nadie puede revisar línea por línea. League of Agents muestra tu proyecto como un mapa, y cada cambio que hace un agente aparece en él. Ves qué cambió, dónde y si todo sigue funcionando, y luego lo conservas o lo deshaces.

Se ejecuta en tu computadora, funciona con los agentes que ya usas y es de código abierto.

![Tres sesiones trabajando en el mapa, una cuarta iniciada en una carpeta junto a ellas, y luego su diff revisado archivo por archivo](docs/media/demo.gif)

## Qué puedes hacer

- **Ve todo tu proyecto de un vistazo.** Sus carpetas y archivos de código en un solo mapa. Aleja para ver la forma, acerca para leer el código.
- **Dirige un agente a líneas exactas.** Selecciona un archivo, una carpeta o unas líneas, y describe el cambio. Junto al nombre del agente ves una de dos cosas:
  - **"Se queda dentro de tu selección."** En macOS, Hermes y DeepSeek Harness se ejecutan dentro del sandbox del propio sistema: ellos, y cada programa que inician, solo pueden escribir dentro de tu selección y en los archivos que el repositorio ignora (el resultado de la compilación, los paquetes instalados). Lo que el sandbox permite fuera del repositorio está [listado más abajo](#el-sandbox-en-macos).
  - **"Puede cambiar archivos fuera de tu selección. Verás cada uno señalado."** Codex y Cursor, todos los agentes donde no hay sandbox (Linux, Windows), y por ahora Claude Code. En macOS el sandbox ya contiene los comandos de Claude Code y un hook contiene sus herramientas de archivos ([cómo](#el-sandbox-en-macos)), pero su tarjeta mantiene este texto hasta que ese diseño haya superado una revisión de seguridad. Las herramientas de edición de Claude Code siguen bloqueadas fuera de tu selección y, con los hooks activados, lo que sus comandos de shell cambian fuera de ella se deja como estaba.

  Cuando una sesión intenta cambiar un archivo fuera de tu selección, la escritura se bloquea y su tarjeta pregunta: "Quiere cambiar <file>". **Permitir** añade el archivo a su selección y la sesión sigue donde se detuvo; **Rechazar** deja el archivo fuera. Si otra sesión está trabajando en ese archivo, la tarjeta dice cuál, y Permitir espera a que esa sesión termine. Los hooks están desactivados hasta que digas que sí: el primer `npx leagueofagents-cli@latest` en una terminal pregunta una vez y lo recuerda, y sin terminal siguen desactivados salvo que pases `--hooks`. Para comprobarlo, busca `"hooks": true` en el `bridge.json` del repositorio, en su carpeta de `~/.config/league-of-agents/repos/`.
- **Mira el trabajo.** Cada sesión que está trabajando tiene un marcador en el archivo que lee o edita, en el mapa y en el minimapa, y sus ediciones se dibujan a medida que llegan. Sigue una sesión para que el mapa se mueva con ella. Los pasos de una ejecución se listan en orden; haz clic en uno para ver su archivo tal como lo dejó ese paso.
- **Edita archivos tú mismo.** Haz doble clic en el código de un archivo para abrirlo en el editor. Las ediciones guardadas se registran y se pueden deshacer como cualquier ejecución de un agente.
- **Actualiza lo que depende de un cambio.** Cambia el nombre de una función y pide al agente que actualice todos los archivos que la usan. El diff de tu cambio va en el prompt del agente. El mapa muestra cada archivo que tocó.
- **Revisa antes de conservar.** Cambia entre Antes, Después y Diff, recorre los archivos cambiados, y luego conserva la ejecución o deshazla con un clic. Una vez conservada, haz un commit solo con los archivos de esa ejecución, con un mensaje que escribes tú; no se hace push de nada.
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

<details>
<summary><b>¿Primera vez con la terminal? Paso a paso.</b></summary>

1. **Abre Terminal.** Pulsa ⌘ Espacio, escribe `Terminal` y pulsa Retorno.
2. **Ve a tu proyecto.** Escribe `cd ` con un espacio detrás, arrastra la carpeta de tu proyecto desde el Finder a la ventana y pulsa Retorno.
3. **Comprueba que es un repositorio git.** Ejecuta `git rev-parse --show-toplevel`. Muestra la carpeta de tu proyecto. Si responde «not a git repository», ejecuta `git init`, que la convierte en uno. No se sube nada.
4. **Inícialo.** Ejecuta `npx leagueofagents-cli@latest`. La primera vez, npm pregunta «Ok to proceed?»: escribe `y`. Después pregunta una vez si añade hooks: cualquiera de las dos respuestas sirve.
5. **Lo que deberías ver.** «League of Agents is running for» seguido de tu carpeta, un enlace, y tu navegador abriendo un mapa de tu proyecto.
6. **Detenlo** con `npx leagueofagents-cli@latest stop`, en la misma carpeta. Cerrar la pestaña del navegador no lo detiene.

</details>

### Requisitos

- macOS. Linux supera todo el conjunto de pruebas, pero aún no se ha probado con un agente real. Windows aún no es compatible.
- git. En un Mac, viene con las herramientas de desarrollo de línea de comandos de Apple: `xcode-select --install`. En Linux, desde tu gestor de paquetes.
- Node 20 o posterior
- Un repositorio git
- Un agente instalado y con sesión iniciada, para ejecutar agentes desde el mapa: consulta [Configurar un agente](#configurar-un-agente). Sin ninguno, los cambios de cualquier editor siguen apareciendo.

### Configurar un agente

League of Agents ejecuta los agentes de línea de comandos que hay en tu computadora, y lista los que encuentra al iniciarse. Solo necesitas los que quieras usar. Instala cada uno desde su propia guía y después compruébalo:

| Agente | Comando que ejecuta | ¿Instalado? | ¿Sesión iniciada? | Iniciar sesión | Guía de instalación |
|---|---|---|---|---|---|
| Claude Code | `claude` | `claude --version` | `claude auth status` | `claude auth login` | [Claude Code](https://code.claude.com/docs/en/setup) |
| Codex (beta) | `codex` | `codex --version` | `codex login status` | `codex login` | [Codex CLI](https://learn.chatgpt.com/docs/codex/cli) |
| Cursor (beta) | `cursor-agent` | `cursor-agent --version` | `cursor-agent status` | `cursor-agent login` | [Cursor CLI](https://cursor.com/docs/cli/installation) |
| Hermes | `hermes acp` | `hermes acp --check` | `hermes status` | `hermes setup` | [Hermes Agent](https://hermes-agent.nousresearch.com/docs/getting-started/installation) |
| DeepSeek Harness | `dsh --profile acp` | `dsh --version` | Sus propios ajustes | Sus propios ajustes | [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) |

- **Cursor y Codex necesitan su agente de línea de comandos, que es independiente de la aplicación.** Tener la aplicación de Cursor o la de ChatGPT no basta: instala el agente de línea de comandos desde la guía de arriba.
- **El comando de Cursor es `agent` o `cursor-agent`**, según la instalación. League of Agents 0.2.0 busca `cursor-agent`. Si solo tienes `agent`, inicia con `LOA_CURSOR_BIN=agent npx leagueofagents-cli@latest`.
- **Después de instalar un agente, detén League of Agents y vuelve a iniciarlo.** Busca los agentes al iniciarse. Claude Code es la excepción: aparece por sí solo una vez instalado y con sesión iniciada.

## Funciona con

Claude Code, desde el mapa o desde tu terminal. Hermes Agent y DeepSeek Harness, desde el mapa, a través del Agent Client Protocol (Hermes necesita su extra `acp`). Codex y Cursor están en beta. Los cambios de cualquier otro editor o agente aparecen gracias al modo de observación. Cada ejecución muestra el modelo que indicó su agente.

Cualquier otro harness que hable el Agent Client Protocol se puede añadir en tus propios ajustes, nunca en los de un repositorio:

```json
[{ "id": "goose", "name": "Goose", "command": ["goose", "acp"] }]
```

Guárdalo como `~/.config/league-of-agents/agents.json` y reinicia League of Agents. Las claves, los proveedores y los modelos se quedan en los ajustes de cada harness. Hermes pregunta antes de editar, y DeepSeek Harness se ejecuta en su modo de solo lectura, así que también pregunta: una edición fuera de tu selección se rechaza. Un harness añadido que no pregunta tiene esas ediciones señaladas después de la ejecución.

<sub>Creado y probado con Claude Code, Hermes Agent y DeepSeek Harness. La compatibilidad con Codex y Cursor sigue sus formatos publicados y supera pruebas contra ellos, pero aún no se ha verificado del todo con ejecuciones reales.</sub>

## Cómo usarlo

**Desde el mapa.** Selecciona archivos, carpetas o líneas, elige un agente, describe el cambio y pulsa Enter. Cuando termine la ejecución, revísala y consérvala o deshazla. Con una ejecución terminada seleccionada, tu siguiente prompt continúa la misma sesión. Para empezar de cero, elige "Empezar una sesión nueva" en el menú "Continuación".

Las líneas seleccionadas se identifican por su texto y las líneas de alrededor, no por sus números. Si unas ediciones, un cambio de rama o un rebase mueven el código, la selección lo sigue. Si el código cambió, se eliminó o no se puede distinguir de una copia idéntica, la selección lo indica y no se ejecuta nada hasta que vuelvas a seleccionar. Cuando un agente edita dentro de tu selección, la selección pasa a las líneas nuevas.

Las sesiones en secciones que no se solapan se ejecutan a la vez; una sesión en todo el repositorio se ejecuta sola. Las ediciones hechas durante una ejecución cuentan en esa ejecución, incluidas las tuyas.

**Desde tu terminal.** Usa Claude Code, Codex o Cursor como siempre. Con los hooks activados, cada prompt que envías se convierte en una ejecución en el mapa, con el prompt como título.

**Desde cualquier editor.** Simplemente trabaja. Cuando los archivos que cambiaste dejan de cambiar durante unos segundos, League of Agents los registra como una ejecución, por ejemplo "main.py editado". Los archivos que git ignora y los archivos nuevos que suelen contener secretos ([listados más abajo](#privacidad-y-seguridad)) nunca crean una ejecución y nunca están en una instantánea, y los cambios de rama y los pulls nunca crean una ejecución.

Un archivo renombrado conserva su lugar en el mapa y aparece como renombrado, con lo que cambió en él. Una carpeta renombrada en bloque también conserva su lugar.

### Comprobaciones

Si tu repositorio no tiene ninguna configurada, League of Agents busca scripts de pruebas y de comprobación de tipos, y pytest, y se ofrece a activarlos. Se guardan en tu carpeta personal, fuera de tu repositorio, salvo que elijas compartirlos con tu equipo en `loa.config.json`. Las comprobaciones que un repositorio incluye en su `loa.config.json` se ofrecen con sus comandos, y solo se ejecutan cuando las activas en tu copia; si la lista cambia, vuelven a esperarte. Una comprobación que no puede ejecutarse en tu computadora, porque falta algo que necesita, aparece como "No se pudo ejecutar" en lugar de fallar, y se puede desactivar con un clic. Consulta [`loa.config.example.json`](loa.config.example.json) para escribir las tuyas.

### Qué escribe en tu computadora

En tu repositorio:

- `.loa/bridge.mjs`: una línea que carga la copia del puente para los hooks del plugin de Claude Code. Se mantiene fuera de git mediante `.git/info/exclude`, y el puente no se inicia en un repositorio que incluya `.loa/` en un commit.
- Nada más: las instantáneas y los registros se guardan fuera del repositorio, en tu carpeta personal. El puente nunca hace commits ni añade nada al área de staging por su cuenta. Un commit solo ocurre cuando haces clic en Commit, y solo con los archivos de esa sesión.
- `loa.config.json`, solo si eliges compartir tus comprobaciones con tu equipo.

En tu carpeta personal:

- `~/.config/league-of-agents/repos/`: una carpeta por repositorio con sus registros de ejecuciones, el puerto y el token del puente, sus instantáneas, una copia del puente que ejecutan los hooks, el diseño del mapa y un log; y un archivo por repositorio con las comprobaciones que activaste o aprobaste allí. Está fuera del repositorio, así que nada de lo que contenga un repositorio puede autorizar sus propios comandos, y ningún comando de git ejecutado en el repositorio llega a los registros: un reset, `git gc` o `git clean` deja el deshacer de cada ejecución como estaba.
- Instantáneas: commits de git en un repositorio propio de League of Agents en esa carpeta, que guarda su propia copia de cada archivo que contiene una instantánea. Nunca tocan tu rama, tu área de staging ni tus refs.

En la configuración de los agentes, solo después de que digas que sí a los hooks:

- Claude Code: `.claude/settings.local.json` en el repositorio, fuera de git.
- Codex: `.codex/hooks.json` en el repositorio, fuera de git si lo creó League of Agents.

Un archivo de hooks que está en git nunca se edita: los hooks contienen rutas de esta computadora. League of Agents lo indica al iniciarse, y las sesiones de terminal de ese agente no se registran.
- Cursor: `~/.cursor/hooks.json` en tu carpeta personal. Cursor solo lee los hooks del proyecto en la carpeta que abrió, que a menudo está por encima del repositorio.

Tus propios hooks en estos archivos nunca se modifican. Tu navegador también guarda el puerto del puente y un token de sesión propio (cada enlace funciona una sola vez: la página cambia el código del enlace por ese token), y tus preferencias de paneles, tema e idioma, en su propio almacenamiento.

Para quitarlo:

| Qué | Cómo |
|---|---|
| Los hooks, en los tres archivos | `npx leagueofagents-cli@latest hooks remove`. Un archivo que creó League of Agents se elimina; un archivo que ya tenías se deja como estaba. |
| Todo lo del repositorio: los hooks, su carpeta en `~/.config/league-of-agents/repos/`, `.loa/` y sus líneas en `.git/info/exclude`, y las comprobaciones que autorizaste para él | `npx leagueofagents-cli@latest uninstall` |
| Las instantáneas que una versión anterior guardaba en `.git/objects` | Quedan sin referencias después de `uninstall`. Git los elimina por su cuenta pasadas dos semanas, o de inmediato con `git gc --prune=now`. |
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
| Claude Code | `claude -p <prompt> --output-format stream-json --verbose --mcp-config <the bridge's permission tool> --permission-prompt-tool mcp__league-of-agents__ask` |
| Cursor | `cursor-agent -p --force --output-format stream-json <prompt>` |
| Codex | `codex exec --json --sandbox workspace-write <prompt>` |

Una continuación añade `--resume <session>` para Claude Code y Cursor, y `resume <session>` para Codex. Lo que permite cada opción de permisos:

- **Claude Code, `--permission-prompt-tool`:** se ejecuta con tus propios ajustes de Claude Code y sus propias comprobaciones de permisos, en el modo de permisos que fijan tus ajustes, como en una terminal. **Lo que allí te preguntaría se pregunta en la tarjeta de la sesión, con Permitir y Rechazar,** y la sesión espera tu respuesta: el puente sirve la herramienta a través de la cual pregunta Claude Code. ([modos de permisos](https://code.claude.com/docs/en/permission-modes), [ejecuciones no interactivas](https://code.claude.com/docs/en/headless)) Así se inicia cualquier ejecución donde no hay sandbox. **En macOS, con Claude Code 2.1.295 o posterior, una sesión en una sección se inicia con `--setting-sources user --permission-mode dontAsk` en su lugar, y con un hook, pasado en `--settings`, que Claude Code ejecuta antes de cada llamada a una herramienta.** Claude Code hace entonces solo lo que el hook permite: el hook hace que cada comando de shell se ejecute dentro del sandbox y contiene las herramientas de archivos, como se [describe más abajo](#el-sandbox-en-macos). Una llamada que el hook nunca vio queda en manos de la propia comprobación de permisos de Claude Code, así que una sesión nunca se ejecuta sin ninguno de los dos. Para ello no se escribe nada en tu repositorio ni en tus ajustes de Claude Code.
- **Claude Code, `--setting-sources user`:** una sesión contenida por el sandbox lee tus propios ajustes de Claude Code y nunca los del repositorio (`.claude/settings.json`, `.claude/settings.local.json`), así que un hook o un servidor MCP que un repositorio incluye en un commit no se ejecuta fuera del sandbox.
- **Cursor, `-p --force`:** **ejecuta comandos de shell sin preguntar.** `-p` le da todas las herramientas, incluidas las de escritura y shell, y `--force` permite los comandos salvo que los hayas denegado explícitamente. ([parámetros de la CLI](https://cursor.com/docs/cli/reference/parameters))
- **Codex, `exec --sandbox workspace-write`:** **ejecuta comandos en el repositorio sin preguntar.** Lee y edita archivos y ejecuta comandos dentro del repositorio. El acceso a la red está desactivado, y no puede salir del repositorio. ([modo no interactivo](https://learn.chatgpt.com/docs/non-interactive-mode), [aprobaciones y seguridad](https://learn.chatgpt.com/docs/agent-approvals-security))

### El sandbox en macOS

Cada sesión de Claude Code, Hermes o DeepSeek Harness queda contenida por el sandbox de macOS (`sandbox-exec`), en una selección o en todo el repositorio.

- **Hermes y DeepSeek Harness se ejecutan enteros dentro de él:** el agente y cada programa que inicia.
- **Claude Code se ejecuta fuera de él, exactamente como en tu terminal,** así que su inicio de sesión y sus ajustes se usan como siempre, y League of Agents nunca los toca. Cada comando de shell que ejecuta se inicia dentro del sandbox. El texto del comando se pone en un archivo y se ejecuta desde ahí, así que ningún shell de fuera lee las comillas ni las sustituciones que contiene.
- **Las herramientas de archivos de Claude Code quedan contenidas por un hook.** Solo leen los archivos de este repositorio. Solo escriben en tu selección; en todo el repositorio, en cualquier archivo salvo la carpeta del propio git y los listados en "Nunca se escriben". Las herramientas añadidas mediante MCP, y cualquier herramienta que pudiera llegar a un archivo o iniciar un programa de otra manera, se rechazan en estas sesiones.
- **Esto necesita Claude Code 2.1.295 o posterior,** que rechaza una llamada a una herramienta cuando su hook no puede ejecutarse; la sesión se detiene entonces. Un Claude Code anterior deja pasar esa llamada, así que sus sesiones no quedan contenidas: funcionan como [donde no hay sandbox](#donde-no-hay-sandbox).

Lo que puede hacer un comando dentro del sandbox:

- **Escrituras dentro del repositorio, en una selección:** solo tu selección y los archivos que el repositorio ignora. Un lockfile fuera de la selección que `npm install` cambiaría también se rechaza, así que selecciona la carpeta que contiene el paquete.
- **Escrituras dentro del repositorio, en todo el repositorio:** cualquier archivo, incluidos los del propio git, para que el agente pueda hacer commits. Nunca los ajustes de git (`.git/config`) ni sus hooks. Una sesión así puede reescribir el historial de git: mover o borrar ramas, etiquetas y commits. Las instantáneas se guardan fuera del repositorio, así que, haga lo que haga con git, su ejecución todavía se puede revertir. La tarjeta de la sesión dice "Puede cambiar cualquier archivo de este repositorio. No puede tocar el resto de tu computadora."
- **Escrituras fuera del repositorio:** solo las carpetas temporales y las cachés (`~/.cache`, `~/Library/Caches`, `~/.npm`), y para Hermes y DeepSeek Harness sus carpetas propias (`~/.hermes`, `~/.dsh`).
- **Lecturas:** nada de tu carpeta personal salvo el repositorio, esas cachés, los ajustes de git (`~/.gitconfig`, `~/.config/git`), los programas que ejecuta (Node, la instalación del propio agente y las carpetas de tu `PATH`), y para Hermes y DeepSeek Harness sus carpetas propias. Tus claves SSH, tus llaveros, los perfiles de tu navegador, la carpeta propia de Claude Code (`~/.claude`) y los demás repositorios de tu carpeta personal no se pueden leer. Cuando a un comando se le rechaza una ruta, la tarjeta de la sesión la nombra.
- **Nunca se escriben, ni siquiera dentro de esos lugares:** la carpeta propia de League of Agents (`~/.config/league-of-agents`: las ejecuciones, las instantáneas y el token del puente, que tampoco se puede leer, y las comprobaciones que aprobaste), el código del propio puente, tus ajustes de git y los hooks de git de tu repositorio, y los archivos de ajustes y de hooks de los agentes (`settings.json` y `settings.local.json` de Claude Code, `config.toml` y `hooks.json` de Codex, `hooks.json` de Cursor, `config.yaml` y `hooks/` de Hermes). Las carpetas que los contienen, y la de tu repositorio, no se pueden mover ni reemplazar.
- **Los comandos se ejecutan sin preguntar, red incluida.** El sandbox limita los archivos, no la red: una sesión puede enviar lo que puede leer, tu repositorio incluido, a cualquier sitio. Usa agentes y prompts en los que confíes.
- **Los archivos que el repositorio ignora siguen siendo escribibles,** como los paquetes instalados en `node_modules`. Lo que los ejecute después, como tus comprobaciones, un hook de git o un servidor de desarrollo, ejecuta lo que escribió la sesión, fuera del sandbox.
- **Las carpetas fuera de tu carpeta personal** (otros discos, `/opt`, `/usr/local`) se pueden leer como puede hacerlo cualquier programa tuyo.
- **Lo que una sesión inicia queda contenido; lo que ya está en marcha, no.** Un servidor de tmux, Docker o un servidor de desarrollo que escribe archivos a petición todavía puede escribir por ella.
- **El propio Claude Code no está en el sandbox.** Lo que hace mediante sus herramientas queda contenido como se indica arriba. Se confía en el programa igual que en tu terminal, y también en los hooks y servidores MCP de tus propios ajustes de Claude Code, que inicia fuera del sandbox. Los ajustes y los hooks de Claude Code del repositorio no se leen.
- **Si el sandbox no puede iniciarse** (el propio puente se está ejecutando dentro de uno), una sesión en una selección se rechaza en lugar de ejecutarse sin él. Una ejecución en todo el repositorio se ejecuta entonces sin él, con el alcance de tu cuenta, y Claude Code mantiene su propia comprobación de permisos.

### Donde no hay sandbox

En Linux y Windows, para Codex y Cursor en todas partes, y para Claude Code anterior a 2.1.295:

- Las herramientas de edición de Claude Code se bloquean fuera de tu selección antes de que escriban, mediante un hook con el que se inicia cada ejecución. No se escribe ningún archivo en tu repositorio para ello.
- Los hooks guardan una instantánea antes y después de cada comando de shell. Lo que cambió fuera de tu selección se deja como estaba en cuanto termina el comando, se conserva y se nombra en la ejecución para que puedas restaurarlo con un clic. **Esa ventana es el comando entero:** un archivo que guardas fuera de toda selección mientras se ejecuta una prueba de 3 minutos también se deja como estaba.
- Cada comando de shell espera a las dos instantáneas: unos 0,2 s en un repositorio de 1200 archivos, unos 5 s en los 186 000 de llvm. En macOS cada uno espera solo a una instantánea de su selección, unos 0,2 s en llvm.
- Nada limita lo que lee una sesión.

## Privacidad y seguridad

League of Agents nunca lee ni escribe el llavero ni ningún otro almacén de credenciales, ni da acceso a ellos. La única excepción: las sesiones de Hermes y DeepSeek Harness leen y escriben la carpeta propia de esos agentes (`~/.hermes`, `~/.dsh`), que guarda sus ajustes y sus claves.

League of Agents never uploads your code anywhere. Your code goes only to the agent you authorized. League of Agents nunca sube tu código a ningún sitio. Tu código va solo al agente que autorizaste. Qué envía, y a dónde, está explicado [más arriba](#qué-envía). Quién puede llegar a League of Agents en tu computadora, y cómo está protegido, se explica en [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md). Informa de los problemas de seguridad de forma privada, como explica [SECURITY.md](SECURITY.md).

**Guarda los secretos en archivos que git ignore.** Un archivo que git ignora nunca está en una instantánea: esa es la protección, así que el lugar de un secreto es `.gitignore`. Como red de seguridad, no como garantía, las instantáneas también excluyen cualquier archivo que aún no esté en un commit con uno de estos nombres, en cualquier carpeta y sean sus letras mayúsculas o minúsculas: `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `*.kdbx`, `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`, `.npmrc`, `.pypirc`, `.netrc`, `.git-credentials`, `.htpasswd`, `credentials.json`, `secrets.json`, `secrets.yaml`, `secrets.yml`, `service-account*.json`, `*.tfvars`. Un secreto con cualquier otro nombre, en un archivo que git no ignora, entra en las instantáneas como cualquier archivo. Un archivo que ya está en un commit forma parte del historial de tu repositorio, y las instantáneas lo incluyen.

Las instantáneas se quedan en tu computadora: no están en ninguna ref de tu repositorio, así que ningún push las envía, `git push --mirror` incluido, y tampoco copiar la carpeta `.git`.

## Límites

- macOS. Linux supera todo el conjunto de pruebas en CI, pero aún no se ha probado con un agente real; allí abre la app local. Windows aún no es compatible.
- No son compatibles las máquinas remotas, SSH ni los dev containers. League of Agents debe ejecutarse en la misma computadora que tu navegador.
- Un mapa muestra hasta 5000 archivos de código, y las primeras 400 líneas de cada uno en su tarjeta; un archivo se abre completo, en antes, después y diff. En un repositorio más grande eliges una carpeta para el mapa, y puedes cambiarla en cualquier momento. Los archivos de más de 16 MB no aparecen en el mapa.
- Los archivos que no son de código, como las imágenes, están en las instantáneas y en el deshacer, pero no en el mapa.
- Los archivos que git ignora y los archivos nuevos que suelen contener secretos nunca están en una instantánea y nunca crean una ejecución por sí solos. La actividad del propio agente es distinta: lo que lee, imprime o edita se guarda en sus ejecuciones, en `~/.config/league-of-agents/repos/` en tu computadora, así que si un agente abre un archivo con secretos, su contenido puede estar ahí. `uninstall` lo elimina.
- Dentro de una sesión, los agentes ejecutan comandos sin preguntar, red incluida, y una sesión puede enviar el contenido del repositorio por la red. En macOS el sandbox limita qué archivos lee y escribe una sesión ([la lista](#el-sandbox-en-macos)); no limita la red. Las ejecuciones en Linux y Windows, Codex y Cursor en todas partes, y Claude Code anterior a 2.1.295 no están en un sandbox.
- En una sesión de Claude Code contenida por el sandbox (macOS, Claude Code 2.1.295 o posterior), las herramientas añadidas mediante MCP se rechazan.
- En una sesión sobre una selección, una instalación editable (`pip install -e .`) se rechaza: escribe una carpeta `egg-info` en la raíz del repositorio, fuera de la selección. Sin el bloqueo, la propia comprobación de permisos de Claude Code rechaza todos los comandos de instalación.
- Una sesión en una selección puede escribir archivos que el repositorio ignora, como `node_modules` y el resultado de la compilación. Tus comprobaciones, tus hooks de git y tu servidor de desarrollo pueden ejecutar esos archivos después, fuera del sandbox.
- Las ejecuciones en secciones que no se solapan trabajan a la vez; una ejecución en todo el repositorio trabaja sola.
- Comandos de shell. Hermes los ejecuta sin preguntar, salvo los que considera peligrosos, que League of Agents rechaza. En macOS, en una sección, tanto Hermes como DeepSeek Harness se ejecutan dentro del sandbox de la sección, así que ningún comando puede escribir fuera de ella; DeepSeek Harness se ejecuta entonces en su modo de acceso completo, porque su propio sandbox no puede iniciarse dentro de otro. En los demás casos DeepSeek Harness los ejecuta en solo lectura, así que un comando que escribe se rechaza. Lo que un comando cambia dentro de la sección se señala como no hecho por las herramientas de edición del agente mientras trabajan otras sesiones, porque solo las herramientas de edición nombran los archivos que cambian. Revertir lo deshace.
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

- **Fija una versión.** `@latest` descarga la versión más reciente cada vez. Para ejecutar la misma versión en todas partes, indícala: `npx leagueofagents-cli@0.2.0`. Las versiones aparecen en [npm](https://www.npmjs.com/package/leagueofagents-cli?activeTab=versions) y en las etiquetas de este repositorio.
- **Un registro interno.** El paquete no tiene dependencias, así que un mirror solo necesita el propio `leagueofagents-cli`: `npx --registry https://npm.example.internal leagueofagents-cli@0.2.0`, o define `registry` en tu `.npmrc`.
- **Sin sitio web.** `--local` usa solo la app que League of Agents sirve en 127.0.0.1, en todos los navegadores, y no deja que se conecte ningún sitio web. No se descarga nada de leagueofagents.dev.
- **Comprobaciones en un repositorio compartido.** Las comprobaciones incluidas en `loa.config.json` solo se ejecutan en una computadora después de que la persona que la usa apruebe esa lista exacta, y de nuevo tras cualquier cambio en ella. Las aprobaciones se guardan en la carpeta personal de cada persona, nunca en el repositorio.
- **Archivos de hooks en git.** Un archivo de hooks que está en git nunca se edita, así que las sesiones de terminal de ese agente no se registran.
- **Qué se queda en cada ordenador.** Las ejecuciones y las instantáneas se guardan por repositorio y por computadora: las 500 ejecuciones más recientes y todas las de los últimos 30 días. Las instantáneas excluyen los archivos que git ignora y los archivos sin seguimiento que suelen contener secretos ([lista](#privacidad-y-seguridad)). `git push --mirror` las enviaría; los push normales nunca lo hacen.

## Cómo funciona

League of Agents tiene dos partes:

- **El puente** (`bridge/loa.mjs`) se ejecuta en tu computadora, dentro de tu repositorio. Node 20 o posterior, sin dependencias. Antes y después de cada ejecución, guarda una instantánea de tus archivos en un commit de git usando un índice privado, así que tu rama y tu área de staging nunca se tocan. Los diffs salen de comparar las dos instantáneas. Deshacer restaura la instantánea de "antes", y pregunta primero si un archivo volvió a cambiar desde entonces. El puente nunca hace commits ni añade nada al área de staging por su cuenta. Un commit solo ocurre cuando haces clic en Commit, y solo con los archivos de esa sesión: se construye en un índice privado a partir de tu último commit más esos archivos tal como los dejó la sesión, tu rama solo se mueve si sigue donde estaba, y en tu área de staging solo cambian las entradas de esos archivos, así que aparecen limpios y todo lo demás que tenías en staging queda como estaba. Un archivo que habías cambiado antes de la sesión aparece en la lista y se deja fuera salvo que lo marques, y no se hace ningún commit si un archivo cambió desde la sesión. El commit lo hace el propio git, así que tus hooks se ejecutan (pre-commit solo ve esos archivos en staging, y commit-msg puede cambiar el mensaje) y los commits se firman si configuraste git para firmarlos. Si un hook falla, no se hace ningún commit y se muestra su salida.
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
