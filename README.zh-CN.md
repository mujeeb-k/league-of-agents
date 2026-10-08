<p align="center"><img src="brand/wordmark-600.png" alt="League of Agents" width="420"></p>

[English](README.md) · [简体中文](README.zh-CN.md) · [Français](README.fr.md) · [Português (Brasil)](README.pt-BR.md) · [Español](README.es.md)

> 测试版翻译，尚未经母语读者审校。以英文版 [README.md](README.md) 为准。

## League of Agents 是什么？

**See every change your agents make.**<br>
查看你的代理做出的每一处改动。

League of Agents 是你的代码库的地图，你在上面指挥编码代理并审查它们的工作。

编码代理改动的代码多到没人能逐行审查。League of Agents 把你的项目显示为一张地图，代理做出的每一处改动都会落在上面。你能看到改了什么、改在哪里、是否仍然可用，然后保留它或撤销它。

它在你的电脑上运行，适用于你已经在用的代理，并且是开源的。

![在地图上选择一个文件夹，让 Claude Code 做一个改动，然后逐个文件审查这次运行的差异](docs/media/demo.gif)

## 你可以做什么

- **一眼看到整个项目。** 它的文件夹和代码文件都在一张地图上。缩小看整体结构，放大阅读代码。
- **让代理精确到行。** 选择一个文件、一个文件夹或几行代码，然后描述改动。开启 hooks 后，Claude Code 无法用它的编辑工具编辑你所选范围之外的内容。在你同意之前，hooks 都是关闭的：在终端中第一次运行 `npx leagueofagents-cli@latest` 时会询问一次并记住你的选择；没有终端时，除非你传入 `--hooks`，否则 hooks 保持关闭。要确认，请在 `.loa/bridge.json` 中查找 `"hooks": true`。Codex 和 Cursor 在你所选范围之外的编辑会在运行结束后被标出；hooks 关闭时，或 Claude Code 使用了 shell 命令时，它的此类编辑也会被标出。
- **自己编辑文件。** 双击文件的代码即可在编辑器中打开。保存的编辑会被记录下来，并且可以像任何代理运行一样撤销。
- **更新依赖某个改动的内容。** 重命名一个函数，然后让代理更新所有使用它的文件。你的改动的差异会放进代理的提示词中。地图会显示它改动过的每个文件。
- **先审查，再保留。** 在之前、之后和差异之间切换，逐个查看改动的文件，然后一键保留或撤销这次运行。
- **自动运行你的检查。** 每次改动了文件的运行结束后，测试和类型检查都会运行，让你知道代码是否仍然可用。

## 快速开始

在任意一个是 git 仓库的项目文件夹中打开终端，然后任选其一：

**让你的代理来设置。** 把这段粘贴到 Claude Code、Codex 或 Cursor 中：

```text
Read leagueofagents.dev/setup.md and set up League of Agents in this repo.
```

**或者自己运行：**

```bash
npx leagueofagents-cli@latest
```

接下来会发生什么：

1. League of Agents 在后台启动，并在你的浏览器中把你的仓库打开为一张地图。
2. 在 Chrome、Edge、Brave 和 Arc 中，它会在 leagueofagents.dev 上打开。浏览器会询问一次是否允许此网站访问你的电脑：请选择允许。在 Safari 和 Firefox 中，它会打开本地应用，不需要任何权限。
3. 选择一个文件，描述一个改动，然后按 Enter。

### 系统要求

- macOS。Linux 能通过完整的测试套件，但还没有用真实的代理试过。暂不支持 Windows。
- git。在 Mac 上，它随 Apple 的命令行开发者工具一起提供：`xcode-select --install`。在 Linux 上，通过你的包管理器安装。
- Node 20 或更高版本
- 一个 git 仓库
- 已安装并登录的 Claude Code，用于从地图运行代理。没有它，来自任何编辑器的改动仍会显示出来。

## 适用于

Claude Code，可以从地图或终端使用。Hermes Agent 和 DeepSeek Harness 通过 Agent Client Protocol 从地图使用（Hermes 需要安装它的 `acp` 扩展）。Codex 和 Cursor 处于测试版。来自任何其他编辑器或代理的改动会通过监视模式显示出来。每次运行都会显示其代理报告的模型。

任何其他支持 Agent Client Protocol 的 harness 都可以添加到你自己的设置中，而不是仓库的设置中：

```json
[{ "id": "goose", "name": "Goose", "command": ["goose", "acp"] }]
```

把它保存为 `~/.config/league-of-agents/agents.json`，然后重启 League of Agents。密钥、服务商和模型都保留在各个 harness 自己的设置中。Hermes 会在编辑前询问；DeepSeek Harness 以它的只读模式运行，所以也会询问：你的选择范围之外的编辑会被拒绝。你添加的 harness 如果不询问，这类编辑会在运行结束后标出。

<sub>使用 Claude Code、Hermes Agent 和 DeepSeek Harness 构建和测试。对 Codex 和 Cursor 的支持遵循它们公开的格式，并通过了针对这些格式的测试，但还没有用真实的运行完全验证。</sub>

## 使用方法

**从地图。** 选择文件、文件夹或代码行，选一个代理，描述改动，然后按 Enter。运行结束后，审查它，然后保留或撤销。选中一次已完成的运行时，你的下一个提示词会继续同一个会话。移除“后续”标签即可开始新会话。

所选的行是按它们的文本和周围的行来定位的，而不是按行号。如果编辑、切换分支或 rebase 移动了代码，所选内容会跟着移动。如果代码被改动、被删除，或者无法与一份完全相同的副本区分开，所选内容会提示这一点，在你重新选择之前不会运行任何东西。当代理在你所选范围内编辑时，所选内容会更新为新的行。

代理运行期间所做的编辑都会计入这次运行，包括你自己的编辑。同一时间只进行一次运行。

**从终端。** 像平常一样使用 Claude Code、Codex 或 Cursor。开启 hooks 后，你发送的每个提示词都会在地图上成为一次运行，以该提示词为标题。

**从任何编辑器。** 照常工作即可。当你改动的文件停止变化几秒后，League of Agents 会把它们记录为一次运行，比如“编辑了 main.py”。git 忽略的文件，以及通常存放密钥的新文件（[见下方列表](#隐私与安全)）永远不会被记录；切换分支和 pull 也永远不会产生运行。

重命名的文件在地图上保持原位，并显示为已重命名，同时显示其中改了什么。整体重命名的文件夹也保持原位。

### 检查

如果你的仓库还没有设置任何检查，League of Agents 会查找测试和类型检查脚本以及 pytest，并提议开启它们。它们保存在你的主目录中、仓库之外，除非你选择在 `loa.config.json` 中与团队共享。仓库在其 `loa.config.json` 中提交的检查会连同命令一起展示给你，只有在你自己的副本中开启后才会运行；如果列表有变化，它们会再次等待你确认。如果某个检查因为所需的东西没有安装而无法在你的电脑上运行，它会显示为“无法运行”而不是失败，并且可以一键关闭。要编写你自己的检查，请参阅 [`loa.config.example.json`](loa.config.example.json)。

### 它在你的电脑上写入什么

在你的仓库中：

- `.loa/`：运行记录、桥接程序的端口和令牌、一个私有的快照索引、hooks 运行的桥接程序副本、地图的布局，以及一份日志。它通过 `.git/info/exclude` 排除在 git 之外；如果仓库提交了它，桥接程序将不会启动。
- 快照：私有 `refs/loa/` 引用下的 git 提交，存放在 `.git/objects` 中。它们永远不会触碰你的分支或暂存区。
- `loa.config.json`，仅当你选择与团队共享你的检查时才会写入。

在你的主目录中：

- `~/.config/league-of-agents/repos/`：每个仓库一个文件，记录你在该仓库中开启或批准的检查。它在仓库之外，所以仓库中的任何内容都无法自行允许运行自己的命令。

在代理的设置中，仅在你同意使用 hooks 之后：

- Claude Code：仓库中的 `.claude/settings.local.json`，排除在 git 之外。
- Codex：仓库中的 `.codex/hooks.json`；如果是 League of Agents 创建的，会排除在 git 之外。

已纳入 git 的 hook 文件永远不会被编辑：hooks 中保存的是这台电脑上的路径。League of Agents 会在启动时提示这一点，并且该代理的终端会话不会被记录。
- Cursor：主目录中的 `~/.cursor/hooks.json`。Cursor 只从它打开的文件夹读取项目 hooks，而那个文件夹往往在仓库的上层。

这些文件中你自己的 hooks 永远不会被改动。你的浏览器也会在它自己的存储中保存桥接程序的端口和令牌，以及你对面板、主题和语言的选择。

要移除它：

| 内容 | 方法 |
|---|---|
| hooks，三个文件中的全部 | `npx leagueofagents-cli@latest hooks remove`。League of Agents 创建的文件会被删除；你原有的文件会恢复原样。 |
| 仓库中的全部内容：hooks、`refs/loa/`、`.loa/` 及其在 `.git/info/exclude` 中的行，以及你为该仓库允许的检查 | `npx leagueofagents-cli@latest uninstall` |
| `.git/objects` 中的快照对象 | 运行 `uninstall` 后不再被引用。Git 会在两周后自行清理它们，或者用 `git gc --prune=now` 立即清理。 |
| `loa.config.json` | 如果是你创建的，删除它即可。 |
| 你的浏览器保存的内容 | 点击断开连接，或者清除 leagueofagents.dev 的网站数据。 |

## 它会发送什么

League of Agents never uploads your code anywhere. Your code goes only to the agent you authorized.
League of Agents 从不把你的代码上传到任何地方。你的代码只会交给你授权的代理。

- **桥接程序** 只与 127.0.0.1 通信：即你浏览器中的应用，以及你的代理的 hooks。它不发出任何其他网络请求。它在本地运行 git，从不 fetch 或 push。启动时，它会在 leagueofagents.dev 或本地应用上打开你的浏览器，并运行 `claude auth status` 来确认 Claude Code 是否已登录。
- **leagueofagents.dev** 提供静态文件：页面、脚本、字体和图片。它直接从你的浏览器与桥接程序通信，所以你的代码、提示词和运行只在你的浏览器和你的电脑之间传递。它用 Vercel Web Analytics 统计页面访问量：页面的路径（不含 `?` 或 `#` 之后的任何内容）；链接到它的网站；根据请求推断出的国家、地区和城市；以及操作系统、浏览器和设备类型。不使用 cookie。桥接程序在你电脑上提供的应用不做任何统计。详情请见[隐私页面](https://leagueofagents.dev/privacy)。
- **安装** 时会从 npm registry 下载软件包。
- **你的代理** 会收到你的提示词，以及所选文件或代码行的列表（以路径和行号的形式）。“更新依赖它的内容”还会把你的改动的差异放进提示词中。代理会把它读到的和收到的内容发送给它自己的服务提供方，并受该提供方的条款约束。
- **你的检查** 会运行你开启的命令。它们做什么由它们自己决定。

## 它如何启动你的代理

当你从地图运行代理时，桥接程序会用以下命令在你的仓库中启动它。`<prompt>` 是你的提示词，上方写有范围。

| 代理 | 命令 |
|---|---|
| Claude Code | `claude -p <prompt> --output-format stream-json --verbose --permission-mode acceptEdits` |
| Cursor | `cursor-agent -p --force --output-format stream-json <prompt>` |
| Codex | `codex exec --json --sandbox workspace-write <prompt>` |

后续运行会为 Claude Code 和 Cursor 加上 `--resume <session>`，为 Codex 加上 `resume <session>`。各个权限参数允许的操作：

- **Claude Code，`--permission-mode acceptEdits`：** 它会在仓库中创建和编辑文件而不询问，并且**会在仓库中运行 `mkdir`、`touch`、`rm`、`rmdir`、`mv`、`cp` 和 `sed` 而不询问。** 其他 shell 命令和网络请求需要你在 Claude Code 中设置规则；使用 `-p` 时没有人可以询问，所以它们会被拒绝。（[权限模式](https://code.claude.com/docs/en/permission-modes#auto-approve-file-edits-with-acceptedits-mode)，[非交互式运行](https://code.claude.com/docs/en/headless#auto-approve-tools)）范围锁定是 hooks 之一，所以只有在你同意使用 hooks 后才会生效。它只检查 Claude Code 的编辑工具。用上述 shell 命令之一做出的改动不会被阻止；如果它在你所选范围之外，会在运行结束后被标出。
- **Cursor，`-p --force`：** **它会运行 shell 命令而不询问。** `-p` 给它所有工具，包括写入和 shell，`--force` 允许运行命令，除非你明确拒绝了它们。（[CLI 参数](https://cursor.com/docs/cli/reference/parameters)）
- **Codex，`exec --sandbox workspace-write`：** **它会在仓库中运行命令而不询问。** 它在仓库内读取和编辑文件并运行命令。网络访问是关闭的，它也无法越出仓库。（[非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)，[审批与安全](https://learn.chatgpt.com/docs/agent-approvals-security)）

## 隐私与安全

League of Agents never uploads your code anywhere. Your code goes only to the agent you authorized.
League of Agents 从不把你的代码上传到任何地方。你的代码只会交给你授权的代理。它发送什么、发送到哪里，见[上文](#它会发送什么)。谁能访问你电脑上的 League of Agents，以及它如何受到保护，见 [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md)。请按 [SECURITY.md](SECURITY.md) 中的说明私下报告安全问题。

快照不包含 git 忽略的文件，也不包含任何文件夹中尚未提交、且名称为以下之一的文件：`.env`、`.env.*`、`*.pem`、`*.key`、`*.p12`、`*.pfx`、`*.jks`、`*.keystore`、`*.kdbx`、`id_rsa`、`id_dsa`、`id_ecdsa`、`id_ed25519`、`.npmrc`、`.pypirc`、`.netrc`、`.git-credentials`、`.htpasswd`、`credentials.json`、`secrets.json`、`secrets.yaml`、`secrets.yml`、`service-account*.json`、`*.tfvars`。这份列表并不完整：任何其他名称的密钥文件都会像普通文件一样被快照，所以请把密钥放在 git 忽略的文件中。已经提交的文件在你仓库的历史中，快照也会包含它。

除非你主动发送，快照只留在你的电脑上：`git push`、`git push --all` 和 `git push --tags` 从不包含 `refs/loa/`，但 `git push --mirror` 会发送所有引用，包括 `refs/loa/`，复制 `.git` 文件夹也是如此。如果你要镜像一个仓库，请先运行 `uninstall`。

## 限制

- macOS。Linux 能在 CI 中通过完整的测试套件，但还没有用真实的代理试过；在 Linux 上，它会打开本地应用。暂不支持 Windows。
- 不支持远程机器、SSH 和开发容器。League of Agents 必须和你的浏览器运行在同一台电脑上。
- 地图最多显示 1,500 个代码文件，每个文件显示前 400 行。超过 400 KB 的文件不会出现在地图上。差异保留文件的前 4,000 行。
- 非代码文件（比如图片）包含在快照和撤销中，但不会出现在地图上。
- git 忽略的文件，以及通常存放密钥的新文件，永远不会被记录。
- 一个仓库中同一时间只进行一次运行。
- Shell 命令。Hermes 运行命令时不会询问，只有它认为危险的命令会询问，而 League of Agents 会拒绝这些命令。DeepSeek Harness 以只读方式运行命令，所以会写入的命令会被拒绝。命令在仓库中改动的任何内容都属于这次运行：如果在你的选择范围之外会被标出，并且可以用撤销运行撤回。
- 它保留最新的 500 次运行，以及最近 30 天内的所有运行。更早的运行会连同其快照一起删除。
- 网站需要 Chrome、Edge、Brave 或 Arc。Safari 和 Firefox 则使用本地应用。

## 命令和选项

| 命令 | 作用 |
|---|---|
| `npx leagueofagents-cli@latest` | 在后台启动 League of Agents 并打开你的浏览器 |
| `... status` | 显示它是否在运行，以及它的链接 |
| `... stop` | 停止它 |
| `... uninstall` | 移除它添加到仓库中的所有内容 |
| `... hooks remove` | 只移除它的 hooks |

| 选项 | 默认值 | 作用 |
|---|---|---|
| `--port`, `LOA_PORT` | 从 43210 开始的第一个空闲端口 | League of Agents 监听的端口 |
| `--web`, `LOA_WEB_URL` | `https://leagueofagents.dev` | 在 Chrome 系浏览器中打开的网站 |
| `--local` | 关闭 | 在所有浏览器中只使用本地应用：永远不会打开网站，网站也无法连接 |
| `--hooks`, `--no-hooks` | 询问一次 | 不经询问直接添加或跳过代理 hooks |
| `LOA_CLAUDE_BIN` | `claude` | Claude Code 命令 |
| `LOA_CODEX_BIN` | `codex` | Codex 命令 |
| `LOA_CURSOR_BIN` | `cursor-agent` | Cursor 命令（较新的安装可能叫 `agent`） |

## 团队使用

- **固定版本。** `@latest` 每次都会获取最新版本。要在所有地方运行同一个版本，请指明版本号：`npx leagueofagents-cli@0.1.3`。版本列在 [npm](https://www.npmjs.com/package/leagueofagents-cli?activeTab=versions) 上和这个仓库的标签中。
- **内部 registry。** 这个软件包没有依赖，所以镜像只需要 `leagueofagents-cli` 本身：`npx --registry https://npm.example.internal leagueofagents-cli@0.1.3`，或者在你的 `.npmrc` 中设置 `registry`。
- **不使用网站。** `--local` 在所有浏览器中只使用 League of Agents 在 127.0.0.1 上提供的应用，并且不允许任何网站连接。不会从 leagueofagents.dev 获取任何内容。
- **共享仓库中的检查。** 提交在 `loa.config.json` 中的检查，只有在某台电脑的使用者批准了这份确切的列表后才会在那台电脑上运行，列表有任何改动后也需要再次批准。批准记录保存在每个人的主目录中，从不放在仓库里。
- **纳入 git 的 hook 文件。** 已纳入 git 的 hook 文件永远不会被编辑，所以该代理的终端会话不会被记录。
- **什么留在每台电脑上。** 运行和快照按仓库、按电脑保存：最新的 500 次运行，以及最近 30 天内的所有运行。快照不包含 git 忽略的文件，也不包含通常存放密钥的未跟踪文件（[列表](#隐私与安全)）。`git push --mirror` 会把它们发送出去；普通的 push 从不会。

## 工作原理

League of Agents 由两部分组成：

- **桥接程序**（`bridge/loa.mjs`）在你的电脑上、在你的仓库里运行。需要 Node 20 或更高版本，没有依赖。每次运行前后，它都会用一个私有索引把你的文件快照为一个 git 提交，所以你的分支和暂存区永远不会被触碰。差异来自对比这两个快照。撤销会恢复“之前”的快照；如果某个文件在那之后又有改动，会先询问你。
- **应用**（`web/`，用 Vite、React 和 TypeScript 构建）就是你使用的地图。它由 leagueofagents.dev 和桥接程序本身提供。

更多细节见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 开发

```bash
npm --prefix web ci
npm --prefix web run build
cd ~/code/your-project
node ~/code/league-of-agents/bridge/loa.mjs
```

要托管你自己的应用副本，请把仓库部署到 Vercel（`vercel.json` 设定了构建方式），添加你的域名，然后用 `--web https://your-domain` 启动桥接程序。

| 变量 | 默认值 | 作用 |
|---|---|---|
| `LOA_WEB_DIR` | `web/dist` | 桥接程序提供的已构建应用 |
| `LOA_WEB_FILE` | 无 | 改为提供单个 HTML 文件 |

## 参与贡献

请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。贡献按 Apache License 2.0 接受，所有人都须遵守[行为准则](CODE_OF_CONDUCT.md)。

## 许可证

[Apache 2.0](LICENSE)
