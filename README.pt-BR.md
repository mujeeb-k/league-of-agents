<p align="center"><img src="brand/wordmark-600.png" alt="League of Agents" width="420"></p>

[English](README.md) · [简体中文](README.zh-CN.md) · [Français](README.fr.md) · [Português (Brasil)](README.pt-BR.md) · [Español](README.es.md)

> Tradução beta, ainda não revisada por um falante nativo. O [README.md](README.md) em inglês é a referência.

## O que é o League of Agents?

**See every change your agents make.**<br>
Veja cada mudança que seus agentes fazem.

League of Agents é um mapa do seu código onde você dirige agentes de código e revisa o trabalho deles.

Agentes de código mudam mais código do que qualquer pessoa consegue revisar linha por linha. League of Agents mostra seu projeto como um mapa, e cada mudança que um agente faz aparece nele. Você vê o que mudou, onde, e se ainda funciona, e então mantém ou desfaz.

Ele roda no seu computador, funciona com os agentes que você já usa e é open source.

![Três sessões trabalhando no mapa, uma quarta iniciada em uma pasta ao lado delas, e depois o diff dela revisado arquivo por arquivo](docs/media/demo.gif)

## O que você pode fazer

- **Veja seu projeto de uma vez.** As pastas e os arquivos de código dele em um só mapa. Afaste o zoom para ver a forma, aproxime para ler o código.
- **Aponte um agente para linhas exatas.** Selecione um arquivo, uma pasta ou algumas linhas e descreva a mudança. No macOS, o Claude Code (2.1.295 ou mais recente), o Hermes e o DeepSeek Harness têm um interruptor **Trava** abaixo do prompt, desativado a menos que você o ative para aquela sessão ([o que ela faz](#a-trava)). Com ele desativado, e para todo outro agente e todo agente no Linux e no Windows, a sessão pode mudar arquivos fora da sua seleção, e cada um é sinalizado. Onde o Claude Code não tem trava (Linux, Windows ou anterior à 2.1.295), as ferramentas de edição dele continuam bloqueadas fora da sua seleção e, com os hooks ativados, o que os comandos de shell dele mudam fora dela é devolvido ao que era.

  Quando uma sessão tenta mudar um arquivo fora da sua seleção, a gravação é bloqueada e o cartão dela pergunta, nomeando a sessão: "Claude Code na execução 4 quer mudar <file>". **Permitir** adiciona o arquivo à seleção dela e a sessão continua de onde parou; **Recusar** mantém o arquivo de fora. Se outra sessão está trabalhando nesse arquivo, o cartão diz qual, e Permitir espera até essa sessão terminar. Os hooks ficam desativados até você dizer sim: o primeiro `npx leagueofagents-cli@latest` em um terminal pergunta uma vez e lembra, e sem um terminal eles ficam desativados a menos que você passe `--hooks`. Para conferir, procure `"hooks": true` no `bridge.json` do repositório, na pasta dele em `~/.config/league-of-agents/repos/`.
- **Acompanhe o trabalho.** Cada sessão em andamento tem um marcador no arquivo que ela está lendo ou editando, no mapa e no minimapa, e as edições dela são desenhadas conforme chegam. Siga uma sessão para o mapa se mover com ela. Os passos de uma execução são listados em ordem; clique em um para ver o arquivo dele como esse passo o deixou.
- **Edite arquivos você mesmo.** Dê um clique duplo no código de um arquivo para abri-lo no editor. As edições salvas são registradas e podem ser desfeitas como qualquer execução de agente.
- **Atualize o que depende de uma mudança.** Renomeie uma função e peça ao agente para atualizar cada arquivo que a usa. O diff da sua mudança vai para o prompt do agente. O mapa mostra cada arquivo que ele tocou.
- **Revise antes de manter.** Alterne entre Antes, Depois e Diff, percorra os arquivos mudados e então mantenha a execução ou desfaça com um clique. Depois de mantida, faça commit só dos arquivos dessa execução com uma mensagem que você escreve; nada é enviado com push.
- **Rode suas verificações automaticamente.** Testes e checagens de tipos rodam depois de cada execução que muda arquivos, para você saber se ainda funciona.

## Início rápido

Abra um terminal em qualquer pasta de projeto que seja um repositório git e escolha uma opção:

**Deixe seu agente configurar.** Cole isto no Claude Code, no Codex ou no Cursor:

```text
Read leagueofagents.dev/setup.md and set up League of Agents in this repo.
```

**Ou rode você mesmo:**

```bash
npx leagueofagents-cli@latest
```

O que acontece em seguida:

1. League of Agents inicia em segundo plano e abre seu repositório como um mapa no navegador.
2. No Chrome, Edge, Brave e Arc, ele abre em leagueofagents.dev. O navegador pede uma vez para deixar o site alcançar seu computador: escolha Permitir. No Safari e no Firefox, ele abre o app local, que não precisa de permissão.
3. Selecione um arquivo, descreva uma mudança e pressione Enter.

<details>
<summary><b>Primeira vez no terminal? Passo a passo.</b></summary>

1. **Abra o Terminal.** Pressione ⌘ Espaço, digite `Terminal` e pressione Return.
2. **Vá para o seu projeto.** Digite `cd ` com um espaço depois, arraste a pasta do seu projeto do Finder para a janela e pressione Return.
3. **Confira se é um repositório git.** Rode `git rev-parse --show-toplevel`. Ele mostra a pasta do seu projeto. Se responder “not a git repository”, rode `git init`, que transforma a pasta em um. Nada é enviado.
4. **Inicie.** Rode `npx leagueofagents-cli@latest`. Na primeira vez, o npm pergunta “Ok to proceed?”: digite `y`. Depois ele pergunta uma vez se deve adicionar hooks: qualquer resposta serve.
5. **O que você deve ver.** “League of Agents is running for” seguido da sua pasta, um link, e o navegador abrindo um mapa do seu projeto.
6. **Pare** com `npx leagueofagents-cli@latest stop`, na mesma pasta. Fechar a aba do navegador não o encerra.

</details>

### Requisitos

- macOS. O Linux passa em toda a suíte de testes, mas ainda não foi experimentado com um agente de verdade. O Windows ainda não é suportado.
- git. No Mac, ele vem com as ferramentas de linha de comando para desenvolvedores da Apple: `xcode-select --install`. No Linux, pelo seu gerenciador de pacotes.
- Node 20 ou mais recente
- Um repositório git
- Um agente instalado e com login feito, para rodar agentes a partir do mapa: veja [Configurar um agente](#configurar-um-agente). Sem nenhum, mudanças de qualquer editor continuam aparecendo.

### Configurar um agente

O League of Agents roda os agentes de linha de comando que estão no seu computador, e lista os que encontra ao iniciar. Você só precisa dos que quiser usar. Instale cada um pelo próprio guia e depois confira:

| Agente | Comando que ele roda | Instalado? | Com login? | Fazer login | Guia de instalação |
|---|---|---|---|---|---|
| Claude Code | `claude` | `claude --version` | `claude auth status` | `claude auth login` | [Claude Code](https://code.claude.com/docs/en/setup) |
| Codex (beta) | `codex` | `codex --version` | `codex login status` | `codex login` | [Codex CLI](https://learn.chatgpt.com/docs/codex/cli) |
| Cursor (beta) | `cursor-agent` | `cursor-agent --version` | `cursor-agent status` | `cursor-agent login` | [Cursor CLI](https://cursor.com/docs/cli/installation) |
| Hermes | `hermes acp` | `hermes acp --check` | `hermes status` | `hermes setup` | [Hermes Agent](https://hermes-agent.nousresearch.com/docs/getting-started/installation) |
| DeepSeek Harness | `dsh --profile acp` | `dsh --version` | As próprias configurações | As próprias configurações | [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) |

- **Cursor e Codex precisam do agente de linha de comando, que é separado do aplicativo.** Ter o aplicativo do Cursor ou o do ChatGPT não basta: instale o agente de linha de comando pelo guia acima.
- **O comando do Cursor é `agent` ou `cursor-agent`**, conforme a instalação. O League of Agents 0.2.0 procura `cursor-agent`. Se você só tem `agent`, inicie com `LOA_CURSOR_BIN=agent npx leagueofagents-cli@latest`.
- **Depois de instalar um agente, pare o League of Agents e inicie de novo.** Ele procura os agentes ao iniciar. O Claude Code é a exceção: aparece sozinho depois de instalado e com login feito.

## Funciona com

Claude Code, a partir do mapa ou do seu terminal. Hermes Agent e DeepSeek Harness, a partir do mapa, pelo Agent Client Protocol (o Hermes precisa do extra `acp`). Codex e Cursor estão em beta. Mudanças de qualquer outro editor ou agente aparecem pelo modo de observação. Cada execução mostra o modelo que o agente informou.

Qualquer outro harness que fale o Agent Client Protocol pode ser adicionado nas suas próprias configurações, nunca nas de um repositório:

```json
[{ "id": "goose", "name": "Goose", "command": ["goose", "acp"] }]
```

Salve como `~/.config/league-of-agents/agents.json` e reinicie o League of Agents. Chaves, provedores e modelos ficam nas configurações de cada harness. O Hermes pergunta antes de editar, e o DeepSeek Harness roda no modo somente leitura, então também pergunta: uma edição fora da sua seleção é recusada. Um harness adicionado que não pergunta tem essas edições sinalizadas depois da execução.

<sub>Construído e testado com Claude Code, Hermes Agent e DeepSeek Harness. O suporte a Codex e Cursor segue os formatos publicados por eles e passa em testes contra esses formatos, mas ainda não foi totalmente verificado com execuções reais.</sub>

## Como usar

**A partir do mapa.** Selecione arquivos, pastas ou linhas, escolha um agente, descreva a mudança e pressione Enter. Quando a execução terminar, revise e mantenha ou desfaça. Com uma execução concluída selecionada, seu próximo prompt continua a mesma sessão. Para começar do zero, escolha "Começar uma nova sessão" no menu "Continuação".

As linhas selecionadas são identificadas pelo texto delas e pelas linhas ao redor, não pelos números. Se edições, uma troca de branch ou um rebase moverem o código, a seleção acompanha. Se o código mudou, foi removido ou não pode ser distinguido de uma cópia idêntica, a seleção avisa e nada roda até você selecionar de novo. Quando um agente edita dentro da sua seleção, a seleção passa a ser as novas linhas.

Sessões em seções que não se sobrepõem rodam ao mesmo tempo; uma sessão no repositório inteiro roda sozinha. Edições feitas durante uma execução contam nessa execução, inclusive as suas.

**A partir do seu terminal.** Use o Claude Code, o Codex ou o Cursor como de costume. Com os hooks ativados, cada prompt que você envia vira uma execução no mapa, com o prompt como título.

**A partir de qualquer editor.** É só trabalhar. Quando os arquivos que você mudou ficam parados por alguns segundos, o League of Agents os registra como uma execução, como "main.py editado". Arquivos que o git ignora e arquivos novos que costumam guardar segredos ([listados abaixo](#privacidade-e-segurança)) nunca geram uma execução e nunca entram em um snapshot, e trocas de branch e pulls nunca geram uma execução.

Um arquivo renomeado mantém seu lugar no mapa e aparece como renomeado, com o que mudou nele. Uma pasta renomeada por inteiro também mantém seu lugar.

### Verificações

Se o seu repositório não tem nenhuma configurada, o League of Agents procura scripts de teste e de typecheck e o pytest, e oferece ativá-los. Elas ficam guardadas na sua pasta pessoal, fora do seu repositório, a menos que você escolha compartilhá-las com sua equipe em `loa.config.json`. Verificações que um repositório inclui no commit do seu `loa.config.json` são oferecidas com os comandos delas, e só rodam depois que você as ativa na sua cópia; se a lista mudar, elas esperam por você de novo. Uma verificação que não consegue rodar na sua máquina, porque algo de que ela precisa não está instalado, aparece como "Não deu para rodar" em vez de falhar, e pode ser desativada com um clique. Veja [`loa.config.example.json`](loa.config.example.json) para escrever as suas.

### O que ele grava na sua máquina

No seu repositório:

- `.loa/bridge.mjs`: uma linha que carrega a cópia da ponte para os hooks do plugin do Claude Code. Ele fica fora do git por meio de `.git/info/exclude`, e a ponte não inicia em um repositório que faz commit de `.loa/`.
- Nada mais: snapshots e registros ficam fora do repositório, na sua pasta pessoal. A ponte nunca faz commit nem staging por conta própria. Um commit só acontece quando você clica em Commit, e só para os arquivos daquela sessão.
- `loa.config.json`, só se você escolher compartilhar suas verificações com sua equipe.

Na sua pasta pessoal:

- `~/.config/league-of-agents/repos/`: uma pasta por repositório com os registros de execuções dele, a porta e o token da ponte, os snapshots dele, uma cópia da ponte que os hooks rodam, o layout do mapa e um log; e um arquivo por repositório com as verificações que você ativou ou aprovou nele. Fica fora do repositório, então nada que um repositório contenha pode autorizar os próprios comandos, e nenhum comando git rodado no repositório alcança os registros: um reset, `git gc` ou `git clean` deixa o desfazer de cada execução como estava.
- Snapshots: commits git em um repositório próprio do League of Agents nessa pasta, que guarda a própria cópia de cada arquivo que um snapshot contém. Eles nunca tocam seu branch, sua área de staging nem suas refs.

Nas configurações dos agentes, só depois que você disser sim aos hooks:

- Claude Code: `.claude/settings.local.json` no repositório, mantido fora do git.
- Codex: `.codex/hooks.json` no repositório, mantido fora do git se o League of Agents o criou.

Um arquivo de hooks que está no git nunca é editado: os hooks guardam caminhos deste computador. O League of Agents avisa isso ao iniciar, e as sessões de terminal desse agente não são registradas.
- Cursor: `~/.cursor/hooks.json` na sua pasta pessoal. O Cursor lê hooks de projeto só da pasta que ele abriu, que muitas vezes fica acima do repositório.

Seus próprios hooks nesses arquivos nunca são alterados. Seu navegador também guarda a porta da ponte e um token de sessão próprio (cada link funciona uma vez: a página troca o código do link por esse token), e suas escolhas de painéis, tema e idioma, no próprio armazenamento dele.

Para removê-lo:

| O quê | Como |
|---|---|
| Hooks, nos três arquivos | `npx leagueofagents-cli@latest hooks remove`. Um arquivo que o League of Agents criou é apagado; um arquivo que você já tinha volta a ser como era. |
| Tudo do repositório: hooks, a pasta dele em `~/.config/league-of-agents/repos/`, `.loa/` e as linhas dela em `.git/info/exclude`, e as verificações que você permitiu para ele | `npx leagueofagents-cli@latest uninstall` |
| Snapshots que uma versão anterior guardava em `.git/objects` | Sem referências depois do `uninstall`. O git os remove sozinho depois de duas semanas, ou na hora com `git gc --prune=now`. |
| `loa.config.json` | Apague, se foi você que o criou. |
| O que seu navegador guarda | Clique em Desconectar, ou limpe os dados do site leagueofagents.dev. |

## O que ele envia

League of Agents never uploads your code anywhere. Your code goes only to the agent you authorized.
League of Agents nunca envia seu código para lugar nenhum. Seu código vai só para o agente que você autorizou.

- **A ponte** conversa só com 127.0.0.1: o app no seu navegador e os hooks dos seus agentes. Ela não faz nenhuma outra requisição de rede. Ela roda o git localmente e nunca faz fetch nem push. Ao iniciar, ela abre seu navegador em leagueofagents.dev ou no app local, e roda `claude auth status` para ver se o Claude Code está com login feito.
- **leagueofagents.dev** serve arquivos estáticos: a página, seus scripts, fontes e imagens. Ele conversa com a ponte direto do seu navegador, então seu código, seus prompts e suas execuções trafegam só entre o seu navegador e o seu computador. Ele conta visualizações de página com o Vercel Web Analytics: o caminho da página, sem nada depois de `?` ou `#`; o site que levou até ela; país, região e cidade, deduzidos da requisição; e o sistema operacional, o navegador e o tipo de dispositivo. Sem cookies. O app que a ponte serve no seu computador não conta nada. Os detalhes estão na [página de privacidade](https://leagueofagents.dev/privacy).
- **A instalação** baixa o pacote do registro do npm.
- **Seu agente** recebe seu prompt e uma lista dos arquivos ou linhas selecionados, como caminhos e números de linha. "Atualizar o que depende disto" também coloca o diff da sua mudança no prompt. O agente envia o que lê e o que recebe ao seu próprio provedor, sob os termos desse provedor.
- **Suas verificações** rodam os comandos que você ativou. O que elas fazem depende delas.

## Como ele inicia seu agente

Quando você roda um agente a partir do mapa, a ponte o inicia no seu repositório com estes comandos. `<prompt>` é o seu prompt com o escopo escrito acima dele.

| Agente | Comando |
|---|---|
| Claude Code | `claude -p <prompt> --output-format stream-json --verbose --mcp-config <the bridge's permission tool> --permission-prompt-tool mcp__league-of-agents__ask` |
| Cursor | `cursor-agent -p --force --output-format stream-json <prompt>` |
| Codex | `codex exec --json --sandbox workspace-write <prompt>` |

Uma continuação adiciona `--resume <session>` para o Claude Code e o Cursor, e `resume <session>` para o Codex. O que cada flag de permissão permite:

- **Claude Code, `--permission-prompt-tool`:** ele roda com as suas próprias configurações do Claude Code e as próprias verificações de permissões dele, no modo de permissão que suas configurações definem, como em um terminal. **O que ele perguntaria a você lá é perguntado no cartão da sessão, com Permitir e Recusar,** e a sessão espera sua resposta: a ponte serve a ferramenta pela qual o Claude Code pergunta. ([modos de permissão](https://code.claude.com/docs/en/permission-modes), [execuções não interativas](https://code.claude.com/docs/en/headless)) É assim que começa toda execução. **No macOS, com o Claude Code 2.1.295 ou mais recente, uma sessão que você trava em uma seção também começa com `--setting-sources user`, e com um hook, passado em `--settings`, que o Claude Code roda antes de cada chamada de ferramenta.** O hook recusa o que iria além da seção e não decide mais nada: cada comando de shell segue reescrito para rodar dentro do sandbox, e as ferramentas de arquivo ficam contidas na seção, como [descrito abaixo](#o-sandbox-no-macos). A própria verificação de permissões do Claude Code continua rodando em tudo o que o hook deixa passar, e o que ela perguntaria é perguntado no cartão, com o comando como o Claude Code o escreveu. Uma chamada que o hook não consegue verificar é recusada. Nada é gravado no seu repositório nem nas suas configurações do Claude Code para isso.
- **Claude Code, `--setting-sources user`:** uma sessão contida pelo sandbox lê as suas próprias configurações do Claude Code e nunca as do repositório (`.claude/settings.json`, `.claude/settings.local.json`), então um hook ou servidor MCP que um repositório inclui em um commit não roda fora do sandbox.
- **Cursor, `-p --force`:** **ele roda comandos de shell sem perguntar.** `-p` dá a ele todas as ferramentas, incluindo escrita e shell, e `--force` permite comandos a menos que você os tenha negado explicitamente. ([parâmetros da CLI](https://cursor.com/docs/cli/reference/parameters))
- **Codex, `exec --sandbox workspace-write`:** **ele roda comandos no repositório sem perguntar.** Ele lê e edita arquivos e roda comandos dentro do repositório. O acesso à rede fica desligado, e ele não pode ir além do repositório. ([modo não interativo](https://learn.chatgpt.com/docs/non-interactive-mode), [aprovações e segurança](https://learn.chatgpt.com/docs/agent-approvals-security))

### A trava

**Com a trava desativada, um agente pode fazer tudo o que você pode, inclusive no League of Agents.** Ele roda com o alcance da sua conta, como em um terminal: pode ler e mudar qualquer arquivo que você pode, rodar qualquer programa e ler a chave que a ponte guarda para este repositório, com a qual pode fazer tudo o que você pode fazer no League of Agents (responder a uma pergunta, fazer commit, reverter, iniciar sessões). Só as próprias verificações de permissões dele ficam no caminho, e são as que você define para ele. É assim que roda toda sessão do Cursor, toda sessão no Linux e no Windows, toda sessão no repositório inteiro e toda sessão do Claude Code, do Hermes ou do DeepSeek Harness que você não trava.

Com a trava ativada (macOS, uma sessão em uma seleção, Claude Code 2.1.295 ou mais recente, Hermes ou DeepSeek Harness), a sessão é contida pelo sandbox do macOS: ela grava só na sua seleção e em arquivos que o repositório ignora, e não lê a chave da ponte, nem as Chaves do macOS, nem o perfil de nenhum navegador, onde fica o login do app. O que mais a trava desativa é dito ao lado do interruptor: para o Claude Code, as configurações e os hooks do Claude Code do próprio repositório, e as ferramentas adicionadas por MCP. Quando a trava recusa algo, o cartão diz por quê e oferece continuar a sessão sem a trava.

### O sandbox no macOS

Uma sessão que você trava é contida pelo sandbox do macOS (`sandbox-exec`).

- **O Hermes e o DeepSeek Harness rodam inteiros dentro dele:** o agente e cada programa que ele inicia.
- **O Claude Code roda fora dele, exatamente como no seu terminal,** então o login e as configurações dele são usados como de costume, e o League of Agents nunca toca neles. Cada comando de shell que ele roda começa dentro do sandbox. O texto do comando é colocado em um arquivo e rodado a partir dele, então nenhuma aspa ou substituição nele é lida por um shell de fora.
- **As ferramentas de arquivo do Claude Code são contidas por um hook.** Elas leem o que um comando pode ler (abaixo) e gravam só na sua seleção. Ferramentas adicionadas por MCP, e qualquer ferramenta que poderia alcançar um arquivo ou iniciar um programa de outro jeito, são recusadas nessas sessões.
- **Isso precisa do Claude Code 2.1.295 ou mais recente,** que recusa uma chamada de ferramenta quando o hook dela não consegue rodar; a sessão é então interrompida. Um Claude Code mais antigo deixa essa chamada passar, então as sessões dele não são contidas: elas funcionam como [onde não há sandbox](#onde-não-há-sandbox).

O que um comando pode fazer dentro do sandbox:

- **Gravações dentro do repositório:** só na sua seleção e em arquivos que o repositório ignora. Um lockfile fora da seleção que o `npm install` mudaria também é recusado, então selecione a pasta que contém o pacote.
- **Gravações fora do repositório:** só em pastas temporárias e em caches (`~/.cache`, `~/Library/Caches`, `~/.npm`), e, para o Hermes e o DeepSeek Harness, nas pastas próprias deles (`~/.hermes`, `~/.dsh`).
- **Leituras:** o que ele leria em qualquer outro lugar, exceto a chave da ponte e os registros do League of Agents, as Chaves do macOS (`~/Library/Keychains`) e os perfis dos navegadores: Chrome, Edge, Chromium, Brave, Arc, Vivaldi, Opera, Firefox, Zen, Orion e Safari (`~/Library/Safari`, o contêiner dele, `~/Library/WebKit`, `~/Library/Cookies`, `~/Library/HTTPStorages`). Um navegador guardado em outro lugar não fica coberto. Quando um caminho é recusado a um comando, o cartão da sessão diz qual.
- **Nunca gravados, mesmo dentro dessas pastas:** a pasta própria do League of Agents (`~/.config/league-of-agents`: as execuções, os snapshots e o token da ponte, que também não pode ser lido, e as verificações que você aprovou), o código da própria ponte, suas configurações do git e os hooks git do seu repositório e os arquivos de configurações e de hooks dos agentes (`settings.json` e `settings.local.json` do Claude Code, `config.toml` e `hooks.json` do Codex, `hooks.json` do Cursor, `config.yaml` e `hooks/` do Hermes). As pastas que os contêm, e a do seu repositório, não podem ser movidas nem substituídas.
- **Os comandos rodam sem perguntar, rede incluída.** O sandbox limita arquivos, não a rede: uma sessão pode enviar o que consegue ler, incluindo seu repositório, para qualquer lugar. Use agentes e prompts em que você confia.
- **Arquivos que o repositório ignora continuam graváveis,** como os pacotes instalados em `node_modules`. O que os roda depois, como suas verificações, um hook git ou um servidor de desenvolvimento, roda o que a sessão gravou, fora do sandbox.
- **Pastas fora da sua pasta pessoal** (outros discos, `/opt`, `/usr/local`) podem ser lidas como qualquer programa seu pode ler.
- **O que uma sessão inicia fica contido; o que já está rodando, não.** Um servidor tmux, o Docker ou um servidor de desenvolvimento que grava arquivos sob pedido ainda pode gravar por ela.
- **O próprio Claude Code não fica no sandbox.** O que ele faz pelas ferramentas dele é contido como descrito acima. O programa recebe a mesma confiança que tem no seu terminal, e o mesmo vale para os hooks e servidores MCP das suas próprias configurações do Claude Code, que ele inicia fora do sandbox. As configurações e os hooks do Claude Code do repositório não são lidos.
- **Se o sandbox não consegue iniciar** (a própria ponte está rodando dentro de um), uma sessão travada é recusada em vez de rodar sem ele.

### Onde não há sandbox

No Linux e no Windows, para o Codex e o Cursor em qualquer lugar, e para o Claude Code anterior à 2.1.295 (uma sessão do Claude Code, do Hermes ou do DeepSeek Harness com a trava desativada não tem nada disso: o que ela muda fora da sua seleção é sinalizado na execução):

- As ferramentas de edição do Claude Code são bloqueadas fora da sua seleção antes de gravar, por um hook com que cada execução é iniciada. Nenhum arquivo é gravado no seu repositório para isso.
- Os hooks gravam um snapshot antes e depois de cada comando de shell. O que ele mudou fora da sua seleção é devolvido ao que era assim que o comando termina, guardado e indicado na execução para você restaurar com um clique. **Essa janela é o comando inteiro:** um arquivo que você salva fora de todas as seleções enquanto um teste de 3 minutos roda também é devolvido ao que era.
- Cada comando de shell espera pelos dois snapshots: cerca de 0,2 s em um repositório de 1.200 arquivos, cerca de 5 s nos 186.000 do llvm. No macOS, cada um espera só por um snapshot da sua seleção, cerca de 0,2 s no llvm.
- Nada limita o que uma sessão lê.

## Privacidade e segurança

O League of Agents nunca lê nem grava as Chaves do macOS nem nenhum outro repositório de credenciais, e nunca dá acesso a eles. A única exceção: as sessões do Hermes e do DeepSeek Harness leem e gravam a pasta própria desses agentes (`~/.hermes`, `~/.dsh`), que guarda as configurações e as chaves deles.

League of Agents never uploads your code anywhere. Your code goes only to the agent you authorized.
League of Agents nunca envia seu código para lugar nenhum. Seu código vai só para o agente que você autorizou. O que ele envia, e para onde, está [acima](#o-que-ele-envia). Quem pode alcançar o League of Agents no seu computador, e como ele é protegido, está em [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md). Relate problemas de segurança de forma privada, como explica o [SECURITY.md](SECURITY.md).

**Guarde segredos em arquivos que o git ignora.** Um arquivo que o git ignora nunca está em um snapshot: essa é a proteção, então o lugar de um segredo é o `.gitignore`. Como rede de segurança, não como garantia, os snapshots também deixam de fora qualquer arquivo ainda sem commit com um destes nomes, em qualquer pasta e sejam as letras maiúsculas ou minúsculas: `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `*.kdbx`, `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`, `.npmrc`, `.pypirc`, `.netrc`, `.git-credentials`, `.htpasswd`, `credentials.json`, `secrets.json`, `secrets.yaml`, `secrets.yml`, `service-account*.json`, `*.tfvars`. Um segredo com qualquer outro nome, em um arquivo que o git não ignora, entra no snapshot como qualquer arquivo. Um arquivo que já está em um commit faz parte do histórico do seu repositório, e os snapshots o incluem.

Os snapshots ficam no seu computador: eles não estão em nenhuma ref do seu repositório, então nenhum push os envia, nem `git push --mirror`, e copiar a pasta `.git` também não.

## Limites

- macOS. O Linux passa em toda a suíte de testes na CI, mas ainda não foi experimentado com um agente de verdade; nele, o app local é aberto. O Windows ainda não é suportado.
- Máquinas remotas, SSH e dev containers não são suportados. O League of Agents precisa rodar no mesmo computador que o seu navegador.
- Um mapa mostra até 5.000 arquivos de código, e as primeiras 400 linhas de cada um no cartão dele; um arquivo abre por inteiro, em antes, depois e diff. Em um repositório maior, você escolhe uma pasta para mapear, e pode trocá-la a qualquer momento. Arquivos com mais de 16 MB não aparecem no mapa.
- Arquivos que não são de código, como imagens, entram nos snapshots e no desfazer, mas não aparecem no mapa.
- Arquivos que o git ignora e arquivos novos que costumam guardar segredos nunca entram em um snapshot e nunca geram uma execução sozinhos. A atividade do próprio agente é diferente: o que ele lê, imprime ou edita fica guardado nas execuções dele, em `~/.config/league-of-agents/repos/` no seu computador, então, se um agente abre um arquivo de segredos, o conteúdo dele pode estar lá. `uninstall` remove isso.
- Dentro de uma sessão, os agentes rodam comandos sem perguntar, rede incluída, e uma sessão pode enviar o conteúdo do repositório pela rede. No macOS, o sandbox limita quais arquivos uma sessão lê e grava ([a lista](#o-sandbox-no-macos)); ele não limita a rede. Sessões com a trava desativada, execuções no Linux e no Windows, o Codex e o Cursor em qualquer lugar, e o Claude Code anterior à 2.1.295 não rodam em sandbox.
- Em uma sessão do Claude Code contida pelo sandbox (macOS, Claude Code 2.1.295 ou mais recente), as ferramentas adicionadas via MCP são recusadas.
- Em uma sessão em uma seleção, uma instalação editável (`pip install -e .`) é recusada: ela grava uma pasta `egg-info` na raiz do repositório, fora da seleção. Sem a trava, a própria verificação de permissões do Claude Code recusa todos os comandos de instalação.
- Uma sessão em uma seleção pode gravar arquivos que o repositório ignora, como `node_modules` e a saída de build. Suas verificações, seus hooks git e seu servidor de desenvolvimento podem rodar esses arquivos depois, fora do sandbox.
- Execuções em seções que não se sobrepõem trabalham ao mesmo tempo; uma execução no repositório inteiro trabalha sozinha.
- Comandos de shell. O Hermes os roda sem perguntar, exceto os que considera perigosos, que o League of Agents recusa. No macOS, em uma seção, tanto o Hermes quanto o DeepSeek Harness rodam dentro do sandbox da seção, então nenhum comando pode gravar fora dela; o DeepSeek Harness roda então no modo de acesso total, já que o sandbox dele não consegue iniciar dentro de outro. Nos outros casos, o DeepSeek Harness os roda em modo somente leitura, então um comando que grava é recusado. O que um comando muda dentro da seção é sinalizado como não feito pelas ferramentas de edição do agente enquanto outras sessões trabalham, já que só as ferramentas de edição informam os arquivos que mudam. Reverter desfaz isso.
- Ele guarda as 500 execuções mais recentes, e todas as execuções dos últimos 30 dias. Execuções mais antigas são apagadas, junto com seus snapshots.
- O site precisa do Chrome, Edge, Brave ou Arc. O Safari e o Firefox usam o app local.

## Comandos e opções

| Comando | O que faz |
|---|---|
| `npx leagueofagents-cli@latest` | Inicia o League of Agents em segundo plano e abre seu navegador |
| `... status` | Mostra se ele está rodando, e o link dele |
| `... stop` | Para o League of Agents |
| `... uninstall` | Remove tudo o que ele adicionou ao repositório |
| `... hooks remove` | Remove só os hooks dele |

| Opção | Padrão | O que faz |
|---|---|---|
| `--port`, `LOA_PORT` | Primeira porta livre a partir de 43210 | Porta em que o League of Agents escuta |
| `--web`, `LOA_WEB_URL` | `https://leagueofagents.dev` | Site a abrir em navegadores da família Chrome |
| `--local` | Desligado | Usa só o app local, em todos os navegadores: o site nunca é aberto e não consegue se conectar |
| `--hooks`, `--no-hooks` | Pergunta uma vez | Adiciona ou pula os hooks dos agentes sem perguntar |
| `LOA_CLAUDE_BIN` | `claude` | Comando do Claude Code |
| `LOA_CODEX_BIN` | `codex` | Comando do Codex |
| `LOA_CURSOR_BIN` | `cursor-agent` | Comando do Cursor (instalações mais novas podem chamá-lo de `agent`) |

## Para equipes

- **Fixe uma versão.** `@latest` busca a versão mais nova a cada vez. Para rodar a mesma versão em todo lugar, informe qual: `npx leagueofagents-cli@0.2.0`. As versões estão listadas no [npm](https://www.npmjs.com/package/leagueofagents-cli?activeTab=versions) e nas tags deste repositório.
- **Um registro interno.** O pacote não tem dependências, então um espelho precisa só do próprio `leagueofagents-cli`: `npx --registry https://npm.example.internal leagueofagents-cli@0.2.0`, ou defina `registry` no seu `.npmrc`.
- **Sem site.** `--local` usa só o app que o League of Agents serve em 127.0.0.1, em todos os navegadores, e não deixa nenhum site se conectar. Nada é buscado de leagueofagents.dev.
- **Verificações em um repositório compartilhado.** Verificações incluídas no commit de `loa.config.json` só rodam em um computador depois que a pessoa nele aprova exatamente aquela lista, e de novo depois de qualquer mudança nela. As aprovações ficam na pasta pessoal de cada pessoa, nunca no repositório.
- **Arquivos de hooks no git.** Um arquivo de hooks que está no git nunca é editado, então as sessões de terminal desse agente não são registradas.
- **O que fica em cada computador.** Execuções e snapshots são guardados por repositório, por computador: as 500 execuções mais recentes e todas as execuções dos últimos 30 dias. Os snapshots deixam de fora arquivos que o git ignora e arquivos não rastreados que costumam guardar segredos ([lista](#privacidade-e-segurança)). `git push --mirror` os enviaria; pushes comuns nunca enviam.

## Como funciona

O League of Agents tem duas partes:

- **A ponte** (`bridge/loa.mjs`) roda no seu computador, dentro do seu repositório. Node 20 ou mais recente, sem dependências. Antes e depois de cada execução, ela grava um snapshot dos seus arquivos em um commit git usando um índice privado, então seu branch e sua área de staging nunca são tocados. Os diffs vêm da comparação dos dois snapshots. Desfazer restaura o snapshot de "antes", e pergunta primeiro se algum arquivo mudou de novo desde então. A ponte nunca faz commit nem staging por conta própria. Um commit só acontece quando você clica em Commit, e só para os arquivos daquela sessão: ele é montado em um índice privado a partir do seu último commit mais esses arquivos como a sessão os deixou, seu branch só se move se ainda estiver onde estava, e na sua área de staging só as entradas desses arquivos mudam, então eles aparecem limpos e todo o resto que você colocou em staging fica como estava. Um arquivo que você já tinha mudado antes da sessão é listado e fica de fora a menos que você o marque, e nada entra em commit se um arquivo mudou desde a sessão. O commit é feito pelo próprio git, então seus hooks rodam (o pre-commit vê só esses arquivos em staging, e o commit-msg pode mudar a mensagem) e os commits são assinados se você configurou o git para assiná-los. Se um hook falha, nada entra em commit e a saída dele é mostrada.
- **O app** (`web/`, construído com Vite, React e TypeScript) é o mapa que você usa. Ele é servido em leagueofagents.dev e pela própria ponte.

Mais detalhes em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Desenvolvimento

```bash
npm --prefix web ci
npm --prefix web run build
cd ~/code/your-project
node ~/code/league-of-agents/bridge/loa.mjs
```

Para hospedar sua própria cópia do app, faça o deploy do repositório na Vercel (`vercel.json` define o build), adicione seu domínio e inicie a ponte com `--web https://your-domain`.

| Variável | Padrão | O que faz |
|---|---|---|
| `LOA_WEB_DIR` | `web/dist` | App construído que a ponte serve |
| `LOA_WEB_FILE` | nenhum | Serve um único arquivo HTML em vez disso |

## Como contribuir

Veja [CONTRIBUTING.md](CONTRIBUTING.md). Contribuições são aceitas sob a Apache License 2.0, e todos seguem o [código de conduta](CODE_OF_CONDUCT.md).

## Licença

[Apache 2.0](LICENSE)
