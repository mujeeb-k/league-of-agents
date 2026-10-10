<p align="center"><img src="brand/wordmark-600.png" alt="League of Agents" width="420"></p>

[English](README.md) · [简体中文](README.zh-CN.md) · [Français](README.fr.md) · [Português (Brasil)](README.pt-BR.md) · [Español](README.es.md)

> Traduction bêta, pas encore relue par une personne dont c’est la langue. Le [README.md](README.md) en anglais fait référence.

## Qu’est-ce que League of Agents ?

**See every change your agents make.**<br>
Voyez chaque changement que font vos agents.

League of Agents est une carte de votre code où vous dirigez des agents de code et relisez leur travail.

Les agents de code modifient plus de code que personne ne peut en relire ligne par ligne. League of Agents affiche votre projet sous forme de carte, et chaque changement fait par un agent y apparaît. Vous voyez ce qui a changé, où, et si cela fonctionne toujours, puis vous le gardez ou l’annulez.

Il tourne sur votre ordinateur, fonctionne avec les agents que vous utilisez déjà, et il est open source.

![Trois sessions au travail sur la carte, une quatrième lancée sur un dossier voisin, puis relecture de son diff fichier par fichier](docs/media/demo.gif)

## Ce que vous pouvez faire

- **Voir tout votre projet d’un coup d’œil.** Ses dossiers et ses fichiers de code sur une seule carte. Dézoomez pour voir sa forme, zoomez pour lire le code.
- **Diriger un agent vers des lignes précises.** Sélectionnez un fichier, un dossier ou quelques lignes, et décrivez le changement. À côté du nom de l’agent, vous voyez l’une de ces deux mentions :
  - **« Reste dans votre sélection. »** Sous macOS, Claude Code, Hermes et DeepSeek Harness tournent dans le bac à sable du système : eux, et chaque programme qu’ils lancent, ne peuvent écrire que dans votre sélection et dans les fichiers ignorés par le dépôt (résultats de compilation, paquets installés). Ce que le bac à sable autorise en dehors du dépôt est [listé plus bas](#le-bac-à-sable-sous-macos).
  - **« Peut modifier des fichiers en dehors de votre sélection. Chacun vous sera signalé. »** Codex et Cursor, et tous les agents là où il n’y a pas de bac à sable (Linux, Windows). Quand les hooks sont activés, les outils d’édition de Claude Code restent bloqués en dehors de votre sélection, et ce que ses commandes shell changent en dehors d’elle est remis en place.

  Quand une session essaie de modifier un fichier en dehors de votre sélection, l’écriture est bloquée et sa carte demande : « Veut modifier <file> ». **Autoriser** ajoute le fichier à sa sélection et la session reprend là où elle s’était arrêtée ; **Refuser** laisse le fichier en dehors. Si une autre session travaille sur ce fichier, la carte indique laquelle, et Autoriser attend la fin de cette session. Les hooks restent désactivés tant que vous n’avez pas dit oui : le premier `npx leagueofagents-cli@latest` lancé dans un terminal vous le demande une fois et s’en souvient, et sans terminal ils restent désactivés sauf si vous passez `--hooks`. Pour vérifier, cherchez `"hooks": true` dans `.loa/bridge.json`.
- **Suivre le travail.** Chaque session au travail a un marqueur sur le fichier qu’elle lit ou modifie, sur la carte et sur la mini-carte, et ses modifications sont dessinées à mesure qu’elles arrivent. Suivez une session pour que la carte se déplace avec elle. Les étapes d’une exécution sont listées dans l’ordre ; cliquez sur l’une d’elles pour voir son fichier tel que cette étape l’a laissé.
- **Modifier des fichiers vous-même.** Double-cliquez sur le code d’un fichier pour l’ouvrir dans l’éditeur. Les modifications enregistrées sont consignées et peuvent être annulées comme n’importe quelle exécution d’agent.
- **Mettre à jour ce qui dépend d’un changement.** Renommez une fonction, puis demandez à l’agent de mettre à jour chaque fichier qui l’utilise. Le diff de votre changement est ajouté au prompt de l’agent. La carte montre chaque fichier qu’il a touché.
- **Relire avant de garder.** Passez d’Avant à Après et à Diff, parcourez les fichiers modifiés, puis gardez l’exécution ou annulez-la en un clic. Une fois l’exécution gardée, committez seulement ses fichiers avec un message que vous écrivez ; rien n’est poussé.
- **Lancer vos vérifications automatiquement.** Les tests et les vérifications de types se lancent après chaque exécution qui modifie des fichiers, pour que vous sachiez si tout fonctionne encore.

## Démarrage rapide

Ouvrez un terminal dans n’importe quel dossier de projet qui est un dépôt git, puis choisissez :

**Laissez votre agent l’installer.** Collez ceci dans Claude Code, Codex ou Cursor :

```text
Read leagueofagents.dev/setup.md and set up League of Agents in this repo.
```

**Ou lancez-le vous-même :**

```bash
npx leagueofagents-cli@latest
```

Ensuite :

1. League of Agents démarre en arrière-plan et ouvre votre dépôt sous forme de carte dans votre navigateur.
2. Dans Chrome, Edge, Brave et Arc, il s’ouvre sur leagueofagents.dev. Le navigateur demande une fois de laisser le site joindre votre ordinateur : choisissez Autoriser. Dans Safari et Firefox, il ouvre l’application locale, qui n’a besoin d’aucune autorisation.
3. Sélectionnez un fichier, décrivez un changement et appuyez sur Entrée.

### Prérequis

- macOS. Linux passe toute la suite de tests, mais n’a pas encore été essayé avec un vrai agent. Windows n’est pas encore pris en charge.
- git. Sur un Mac, il est fourni avec les outils de développement en ligne de commande d’Apple : `xcode-select --install`. Sous Linux, via votre gestionnaire de paquets.
- Node 20 ou plus récent
- Un dépôt git
- Claude Code installé et connecté, pour lancer des agents depuis la carte. Sans lui, les changements faits dans n’importe quel éditeur apparaissent quand même.

## Compatible avec

Claude Code, depuis la carte ou votre terminal. Hermes Agent et DeepSeek Harness, depuis la carte, par l’Agent Client Protocol (Hermes a besoin de son extra `acp`). Codex et Cursor sont en bêta. Les changements faits dans tout autre éditeur ou agent apparaissent grâce au mode veille. Chaque exécution affiche le modèle indiqué par son agent.

Tout autre harness qui parle l’Agent Client Protocol peut être ajouté dans vos propres réglages, jamais dans ceux d’un dépôt :

```json
[{ "id": "goose", "name": "Goose", "command": ["goose", "acp"] }]
```

Enregistrez-le sous `~/.config/league-of-agents/agents.json`, puis redémarrez League of Agents. Les clés, fournisseurs et modèles restent dans les réglages de chaque harness. Hermes demande avant de modifier, et DeepSeek Harness tourne dans son mode lecture seule, donc il demande aussi : une modification hors de votre sélection est refusée. Un harness ajouté qui ne demande pas voit ces modifications signalées après l’exécution.

<sub>Construit et testé avec Claude Code, Hermes Agent et DeepSeek Harness. La prise en charge de Codex et de Cursor suit leurs formats publiés et passe des tests sur ces formats, mais n’a pas encore été entièrement vérifiée avec de vraies exécutions.</sub>

## Utilisation

**Depuis la carte.** Sélectionnez des fichiers, des dossiers ou des lignes, choisissez un agent, décrivez le changement et appuyez sur Entrée. Quand l’exécution se termine, relisez-la, puis gardez-la ou annulez-la. Si une exécution terminée est sélectionnée, votre prompt suivant continue la même session. Pour repartir de zéro, choisissez « Démarrer plutôt une nouvelle session » dans le menu « Suite ».

Les lignes sélectionnées sont repérées par leur texte et les lignes qui les entourent, pas par leurs numéros. Si des modifications, un changement de branche ou un rebase déplacent le code, la sélection le suit. Si le code a changé, a été supprimé ou ne peut pas être distingué d’une copie identique, la sélection l’indique et rien ne se lance tant que vous n’avez pas sélectionné à nouveau. Quand un agent modifie l’intérieur de votre sélection, la sélection prend les nouvelles lignes.

Les sessions sur des sections qui ne se chevauchent pas tournent en même temps ; une session sur tout le dépôt tourne seule. Les modifications faites pendant une exécution sont comptées dans cette exécution, y compris les vôtres.

**Depuis votre terminal.** Utilisez Claude Code, Codex ou Cursor comme d’habitude. Quand les hooks sont activés, chaque prompt que vous envoyez devient une exécution sur la carte, intitulée d’après le prompt.

**Depuis n’importe quel éditeur.** Travaillez simplement. Quand les fichiers que vous avez modifiés ne bougent plus pendant quelques secondes, League of Agents les enregistre comme une seule exécution, par exemple « main.py modifié ». Les fichiers ignorés par git et les nouveaux fichiers qui contiennent habituellement des secrets ([listés plus bas](#confidentialité-et-sécurité)) ne créent jamais d’exécution et ne sont jamais dans un instantané, et les changements de branche et les pull ne créent jamais d’exécution.

Un fichier renommé garde sa place sur la carte et apparaît comme renommé, avec ce qui y a changé. Un dossier renommé en entier garde aussi sa place.

### Vérifications

Si votre dépôt n’en a aucune de configurée, League of Agents cherche des scripts de test et de vérification de types ainsi que pytest, et propose de les activer. Elles sont conservées dans votre dossier personnel, en dehors de votre dépôt, sauf si vous choisissez de les partager avec votre équipe dans `loa.config.json`. Les vérifications qu’un dépôt committe dans son `loa.config.json` sont proposées avec leurs commandes, et ne se lancent qu’une fois que vous les activez dans votre copie ; si la liste change, elles attendent de nouveau votre accord. Une vérification qui ne peut pas tourner sur votre machine, parce qu’il manque quelque chose dont elle a besoin, apparaît comme « Impossible à lancer » au lieu d’échouer, et peut être désactivée en un clic. Consultez [`loa.config.example.json`](loa.config.example.json) pour écrire les vôtres.

### Ce qu’il écrit sur votre machine

Dans votre dépôt :

- `.loa/` : les enregistrements des exécutions, le port et le jeton du pont, un index d’instantanés privé, une copie du pont qu’exécutent les hooks, la disposition de la carte, et un journal. Il est tenu hors de git par `.git/info/exclude`, et le pont refuse de démarrer dans un dépôt qui le committe.
- Les instantanés : des commits git sous des refs privées `refs/loa/`, stockés dans `.git/objects`. Ils ne touchent jamais votre branche ni votre zone de préparation. Le pont ne committe et ne prépare jamais rien de lui-même. Un commit n’a lieu que lorsque vous cliquez sur Commit, et seulement pour les fichiers de cette session.
- `loa.config.json`, seulement si vous choisissez de partager vos vérifications avec votre équipe.

Dans votre dossier personnel :

- `~/.config/league-of-agents/repos/` : un fichier par dépôt avec les vérifications que vous y avez activées ou approuvées. Il est en dehors du dépôt, donc rien de ce que contient un dépôt ne peut autoriser ses propres commandes.

Dans les réglages des agents, seulement après que vous avez dit oui aux hooks :

- Claude Code : `.claude/settings.local.json` dans le dépôt, tenu hors de git.
- Codex : `.codex/hooks.json` dans le dépôt, tenu hors de git si c’est League of Agents qui l’a créé.

Un fichier de hooks suivi par git n’est jamais modifié : les hooks contiennent les chemins de cet ordinateur. League of Agents le signale au démarrage, et les sessions de terminal de cet agent ne sont pas enregistrées.
- Cursor : `~/.cursor/hooks.json` dans votre dossier personnel. Cursor ne lit les hooks de projet que dans le dossier qu’il a ouvert, qui est souvent au-dessus du dépôt.

Vos propres hooks dans ces fichiers ne sont jamais modifiés. Votre navigateur conserve aussi le port du pont et un jeton de session qui lui est propre (chaque lien ne fonctionne qu’une fois : la page échange le code du lien contre ce jeton), ainsi que vos choix de panneaux, de thème et de langue, dans son propre stockage.

Pour le retirer :

| Quoi | Comment |
|---|---|
| Les hooks, dans les trois fichiers | `npx leagueofagents-cli@latest hooks remove`. Un fichier créé par League of Agents est supprimé ; un fichier que vous aviez déjà est remis tel qu’il était. |
| Tout ce qui est dans le dépôt : les hooks, `refs/loa/`, `.loa/` et ses lignes dans `.git/info/exclude`, et les vérifications que vous y avez autorisées | `npx leagueofagents-cli@latest uninstall` |
| Les objets des instantanés dans `.git/objects` | Plus référencés après `uninstall`. Git les élague de lui-même au bout de deux semaines, ou tout de suite avec `git gc --prune=now`. |
| `loa.config.json` | Supprimez-le, si vous l’avez créé. |
| Ce que conserve votre navigateur | Cliquez sur Se déconnecter, ou effacez les données du site leagueofagents.dev. |

## Ce qu’il envoie

League of Agents never uploads your code anywhere. Your code goes only to the agent you authorized.
League of Agents n’envoie jamais votre code nulle part. Votre code va seulement à l’agent que vous avez autorisé.

- **Le pont** ne communique qu’avec 127.0.0.1 : l’application dans votre navigateur, et les hooks de vos agents. Il ne fait aucune autre requête réseau. Il exécute git localement et ne fait jamais de fetch ni de push. Au démarrage, il ouvre votre navigateur sur leagueofagents.dev ou sur l’application locale, et il lance `claude auth status` pour savoir si Claude Code est connecté.
- **leagueofagents.dev** sert des fichiers statiques : la page, ses scripts, ses polices et ses images. Elle communique avec le pont directement depuis votre navigateur, donc votre code, vos prompts et vos exécutions ne circulent qu’entre votre navigateur et votre ordinateur. Elle compte les pages vues avec Vercel Web Analytics : le chemin de la page, sans ce qui suit `?` ou `#` ; le site qui y a mené ; le pays, la région et la ville, déduits de la requête ; et le système d’exploitation, le navigateur et le type d’appareil. Aucun cookie. L’application que le pont sert sur votre ordinateur ne compte rien. Les détails sont sur la [page de confidentialité](https://leagueofagents.dev/privacy).
- **L’installation** télécharge le paquet depuis le registre npm.
- **Votre agent** reçoit votre prompt et une liste des fichiers ou des lignes sélectionnés, sous forme de chemins et de numéros de ligne. « Mettre à jour ce qui en dépend » ajoute aussi le diff de votre changement au prompt. L’agent envoie ce qu’il lit et ce qu’on lui donne à son propre fournisseur, selon les conditions de ce fournisseur.
- **Vos vérifications** lancent les commandes que vous avez activées. Ce qu’elles font ne dépend que d’elles.

## Comment il lance votre agent

Quand vous lancez un agent depuis la carte, le pont le démarre dans votre dépôt avec ces commandes. `<prompt>` est votre prompt, avec la portée écrite au-dessus.

| Agent | Commande |
|---|---|
| Claude Code | `claude -p <prompt> --output-format stream-json --verbose --permission-mode acceptEdits` |
| Cursor | `cursor-agent -p --force --output-format stream-json <prompt>` |
| Codex | `codex exec --json --sandbox workspace-write <prompt>` |

Une suite ajoute `--resume <session>` pour Claude Code et Cursor, et `resume <session>` pour Codex. Ce que permet chaque option de permission :

- **Claude Code, `--permission-mode acceptEdits` :** il crée et modifie des fichiers dans le dépôt sans demander, et **y lance `mkdir`, `touch`, `rm`, `rmdir`, `mv`, `cp` et `sed` sans demander.** Les autres commandes shell et les requêtes réseau nécessitent une règle que vous définissez dans Claude Code ; avec `-p`, il n’y a personne à qui demander, donc elles sont refusées. ([modes de permission](https://code.claude.com/docs/en/permission-modes#auto-approve-file-edits-with-acceptedits-mode), [exécutions non interactives](https://code.claude.com/docs/en/headless#auto-approve-tools)) C’est ainsi que démarre toute exécution là où il n’y a pas de bac à sable. **Dans le bac à sable sous macOS, une session démarre plutôt avec `--permission-mode bypassPermissions` :** Claude Code lance n’importe quelle commande sans demander, et c’est le bac à sable qui fixe la limite. Son propre contrôle refusait des commandes inoffensives (pipes, boucles, sa propre vérification), et dans le bac à sable il n’ajoute rien que le bac à sable n’impose déjà pour les fichiers.
- **Cursor, `-p --force` :** **il lance des commandes shell sans demander.** `-p` lui donne tous les outils, y compris l’écriture et le shell, et `--force` autorise les commandes sauf si vous les avez explicitement refusées. ([paramètres de la CLI](https://cursor.com/docs/cli/reference/parameters))
- **Codex, `exec --sandbox workspace-write` :** **il lance des commandes dans le dépôt sans demander.** Il lit et modifie des fichiers et lance des commandes à l’intérieur du dépôt. L’accès réseau est coupé, et il ne peut pas sortir du dépôt. ([mode non interactif](https://learn.chatgpt.com/docs/non-interactive-mode), [approbations et sécurité](https://learn.chatgpt.com/docs/agent-approvals-security))

### Le bac à sable sous macOS

Toute session avec Claude Code, Hermes ou DeepSeek Harness tourne dans le bac à sable de macOS (`sandbox-exec`), sur une sélection ou sur tout le dépôt. Il contient l’agent et chaque programme que l’agent lance.

- **Écritures dans le dépôt, sur une sélection :** seulement votre sélection et les fichiers ignorés par le dépôt. Un fichier de verrouillage en dehors de la sélection que `npm install` modifierait est refusé aussi, alors sélectionnez le dossier qui contient le paquet.
- **Écritures dans le dépôt, sur tout le dépôt :** n’importe quel fichier, y compris ceux de git, pour que l’agent puisse committer. Jamais les réglages de git (`.git/config`) ni ses hooks. La carte de la session indique « Peut modifier n’importe quel fichier de ce dépôt. Ne peut pas toucher au reste de votre ordinateur. »
- **Écritures en dehors du dépôt :** seulement les dossiers temporaires, les dossiers de l’agent (`~/.claude`, `~/.hermes`, `~/.dsh`) et les caches (`~/.cache`, `~/Library/Caches`, `~/.npm`). Une session Claude Code peut aussi écrire le fichier de votre trousseau de session (`~/Library/Keychains/login.keychain-db`, avec ses fichiers temporaires et de verrouillage) : Claude Code y conserve sa connexion et doit l’enregistrer quand elle est renouvelée, et macOS n’offre aucun moyen plus étroit d’enregistrer un élément du trousseau.
- **Lectures :** rien dans votre dossier personnel à part le dépôt, les dossiers de l’agent, ces caches, les réglages de git (`~/.gitconfig`, `~/.config/git`), et les programmes qu’il lance : Node, l’installation de l’agent, et les dossiers de votre `PATH`. Vos clés SSH, vos profils de navigateur et les autres dépôts de votre dossier personnel ne peuvent pas être lus. Quand un chemin est refusé à une commande, la carte de la session le nomme. Une session Claude Code peut aussi lire `~/Library/Keychains`, où se trouve sa connexion ; macOS protège chaque élément du trousseau séparément.
- **Jamais écrits, même à l’intérieur de ceux-ci :** le jeton du pont (`.loa/bridge.json` et son journal, qui ne peuvent pas être lus non plus), le code du pont, vos réglages git et les hooks git de votre dépôt, les vérifications approuvées du pont (`~/.config/league-of-agents`), et les fichiers de réglages et de hooks des agents (`settings.json` et `settings.local.json` de Claude Code, `config.toml` et `hooks.json` de Codex, `hooks.json` de Cursor, `config.yaml` et `hooks/` de Hermes). Les dossiers qui les contiennent, et celui de votre dépôt, ne peuvent pas être déplacés ni remplacés.
- **Les commandes se lancent sans demander, réseau compris.** Le bac à sable limite les fichiers, pas le réseau : une session peut envoyer ce qu’elle peut lire, votre dépôt compris, n’importe où. Utilisez des agents et des prompts en qui vous avez confiance.
- **Les fichiers ignorés par le dépôt restent modifiables,** comme les paquets installés dans `node_modules`. Ce qui les exécute plus tard, comme vos vérifications, un hook git ou un serveur de développement, exécute ce que la session a écrit, en dehors du bac à sable.
- **Les dossiers en dehors de votre dossier personnel** (autres disques, `/opt`, `/usr/local`) peuvent être lus comme par n’importe lequel de vos programmes.
- **Ce qu’une session lance est contenu ; ce qui tourne déjà ne l’est pas.** Un serveur tmux, Docker, ou un serveur de développement qui écrit des fichiers sur demande peut encore écrire pour elle.
- **Si le bac à sable ne peut pas démarrer** (le pont tourne lui-même dans un bac à sable), une session sur une sélection est refusée plutôt que lancée sans lui. Une exécution sur tout le dépôt se lance alors sans lui, avec la portée de votre compte, et Claude Code garde son propre contrôle des permissions.

### Là où il n’y a pas de bac à sable

Sous Linux et Windows, et pour Codex et Cursor partout :

- Quand les hooks sont activés, les outils d’édition de Claude Code sont bloqués en dehors de votre sélection avant d’écrire.
- Les hooks prennent un instantané avant et après chaque commande shell. Ce qu’elle a changé en dehors de votre sélection est remis en place dès que la commande se termine, conservé, et nommé sur l’exécution pour que vous puissiez le restaurer en un clic. **Cette fenêtre dure toute la commande :** un fichier que vous enregistrez en dehors de toute sélection pendant qu’un test de 3 minutes tourne est remis en place lui aussi.
- Chaque commande shell attend les deux instantanés : environ 0,2 s sur un dépôt de 1 200 fichiers, environ 5 s sur les 186 000 de llvm. Sous macOS, chacune n’attend qu’un instantané de sa sélection, environ 0,2 s sur llvm.
- Rien ne limite ce qu’une session lit.

## Confidentialité et sécurité

League of Agents never uploads your code anywhere. Your code goes only to the agent you authorized.
League of Agents n’envoie jamais votre code nulle part. Votre code va seulement à l’agent que vous avez autorisé. Ce qu’il envoie, et à qui, est décrit [plus haut](#ce-quil-envoie). Qui peut joindre League of Agents sur votre ordinateur, et comment il est protégé, est décrit dans [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md). Signalez les problèmes de sécurité en privé, comme l’explique [SECURITY.md](SECURITY.md).

Les instantanés excluent les fichiers ignorés par git, et tout fichier pas encore committé portant l’un de ces noms, dans n’importe quel dossier : `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `*.kdbx`, `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`, `.npmrc`, `.pypirc`, `.netrc`, `.git-credentials`, `.htpasswd`, `credentials.json`, `secrets.json`, `secrets.yaml`, `secrets.yml`, `service-account*.json`, `*.tfvars`. Cette liste n’est pas exhaustive : un secret portant un autre nom est mis dans les instantanés comme n’importe quel fichier, alors gardez vos secrets dans des fichiers ignorés par git. Un fichier déjà committé fait partie de l’historique de votre dépôt, et les instantanés l’incluent.

Les instantanés restent sur votre ordinateur sauf si vous les envoyez : `git push`, `git push --all` et `git push --tags` n’incluent jamais `refs/loa/`, mais `git push --mirror` envoie toutes les refs, `refs/loa/` compris, tout comme copier le dossier `.git`. Lancez d’abord `uninstall` si vous faites un miroir d’un dépôt.

## Limites

- macOS. Linux passe toute la suite de tests en CI, mais n’a pas encore été essayé avec un vrai agent ; il y ouvre l’application locale. Windows n’est pas encore pris en charge.
- Les machines distantes, SSH et les dev containers ne sont pas pris en charge. League of Agents doit tourner sur le même ordinateur que votre navigateur.
- Une carte affiche jusqu’à 5 000 fichiers de code, et les 400 premières lignes de chacun sur sa carte ; un fichier s’ouvre en entier, avant, après et diff. Dans un dépôt plus grand, vous choisissez un dossier à cartographier, et pouvez en changer à tout moment. Les fichiers de plus de 16 Mo ne sont pas sur la carte.
- Les fichiers qui ne sont pas du code, comme les images, sont dans les instantanés et dans l’annulation, mais pas sur la carte.
- Les fichiers ignorés par git et les nouveaux fichiers qui contiennent habituellement des secrets ne sont jamais dans un instantané et ne créent jamais d’exécution à eux seuls. L’activité propre d’un agent, c’est différent : ce qu’il lit, affiche ou modifie est conservé dans `.loa/runs/` sur votre ordinateur, donc si un agent ouvre un fichier de secrets, son contenu peut s’y trouver. `uninstall` le supprime.
- Dans une session, les agents lancent des commandes sans demander, réseau compris, et une session peut envoyer le contenu du dépôt sur le réseau. Sous macOS, le bac à sable limite les fichiers qu’une session lit et écrit ([la liste](#le-bac-à-sable-sous-macos)) ; il ne limite pas le réseau. Les exécutions sous Linux et Windows, et Codex et Cursor partout, ne sont pas dans un bac à sable.
- Une session sur une sélection peut écrire dans les fichiers ignorés par le dépôt, comme `node_modules` et les résultats de compilation. Vos vérifications, vos hooks git et votre serveur de développement peuvent exécuter ces fichiers plus tard, en dehors du bac à sable.
- Les exécutions sur des sections qui ne se chevauchent pas travaillent en même temps ; une exécution sur tout le dépôt travaille seule.
- Les commandes shell. Hermes les lance sans demander, sauf celles qu’il juge dangereuses, que League of Agents refuse. Sous macOS, sur une section, Hermes et DeepSeek Harness tournent tous deux dans le bac à sable de la section, donc aucune commande ne peut écrire en dehors ; DeepSeek Harness tourne alors dans son mode accès complet, puisque son propre bac à sable ne peut pas démarrer dans un autre. Ailleurs, DeepSeek Harness les lance en lecture seule, donc une commande qui écrit est refusée. Ce qu’une commande change dans la section est signalé comme n’étant pas fait par les outils d’édition de l’agent pendant que d’autres sessions travaillent, puisque seuls les outils d’édition nomment les fichiers qu’ils modifient. L’annulation de l’exécution le défait.
- Il conserve les 500 exécutions les plus récentes, et toutes celles des 30 derniers jours. Les exécutions plus anciennes sont supprimées, avec leurs instantanés.
- Le site web nécessite Chrome, Edge, Brave ou Arc. Safari et Firefox utilisent l’application locale à la place.

## Commandes et options

| Commande | Ce qu’elle fait |
|---|---|
| `npx leagueofagents-cli@latest` | Démarre League of Agents en arrière-plan et ouvre votre navigateur |
| `... status` | Indique s’il tourne, et son lien |
| `... stop` | L’arrête |
| `... uninstall` | Retire tout ce qu’il a ajouté au dépôt |
| `... hooks remove` | Retire seulement ses hooks |

| Option | Par défaut | Ce qu’elle fait |
|---|---|---|
| `--port`, `LOA_PORT` | Premier port libre à partir de 43210 | Port sur lequel League of Agents écoute |
| `--web`, `LOA_WEB_URL` | `https://leagueofagents.dev` | Site web à ouvrir dans les navigateurs de la famille Chrome |
| `--local` | Désactivé | Utiliser seulement l’application locale, dans tous les navigateurs : le site web n’est jamais ouvert, et ne peut pas se connecter |
| `--hooks`, `--no-hooks` | Demande une fois | Ajouter ou ignorer les hooks des agents sans demander |
| `LOA_CLAUDE_BIN` | `claude` | Commande de Claude Code |
| `LOA_CODEX_BIN` | `codex` | Commande de Codex |
| `LOA_CURSOR_BIN` | `cursor-agent` | Commande de Cursor (les installations récentes peuvent l’appeler `agent`) |

## Pour les équipes

- **Fixez une version.** `@latest` récupère la dernière version à chaque fois. Pour lancer la même version partout, nommez-la : `npx leagueofagents-cli@0.1.3`. Les versions sont listées sur [npm](https://www.npmjs.com/package/leagueofagents-cli?activeTab=versions) et dans les tags de ce dépôt.
- **Un registre interne.** Le paquet n’a aucune dépendance, donc un miroir n’a besoin que de `leagueofagents-cli` lui-même : `npx --registry https://npm.example.internal leagueofagents-cli@0.1.3`, ou définissez `registry` dans votre `.npmrc`.
- **Sans site web.** `--local` n’utilise que l’application que League of Agents sert sur 127.0.0.1, dans tous les navigateurs, et ne laisse aucun site web se connecter. Rien n’est récupéré depuis leagueofagents.dev.
- **Vérifications dans un dépôt partagé.** Les vérifications committées dans `loa.config.json` ne se lancent sur un ordinateur qu’une fois que la personne qui l’utilise a approuvé cette liste exacte, et de nouveau après toute modification de celle-ci. Les approbations sont conservées dans le dossier personnel de chacun, jamais dans le dépôt.
- **Fichiers de hooks dans git.** Un fichier de hooks suivi par git n’est jamais modifié, donc les sessions de terminal de cet agent ne sont pas enregistrées.
- **Ce qui reste sur chaque ordinateur.** Les exécutions et les instantanés sont conservés par dépôt et par ordinateur : les 500 exécutions les plus récentes et toutes celles des 30 derniers jours. Les instantanés excluent les fichiers ignorés par git et les fichiers non suivis qui contiennent habituellement des secrets ([liste](#confidentialité-et-sécurité)). `git push --mirror` les enverrait ; les push ordinaires ne le font jamais.

## Fonctionnement

League of Agents a deux parties :

- **Le pont** (`bridge/loa.mjs`) tourne sur votre ordinateur, dans votre dépôt. Node 20 ou plus récent, aucune dépendance. Avant et après chaque exécution, il prend un instantané de vos fichiers dans un commit git à l’aide d’un index privé, pour que votre branche et votre zone de préparation ne soient jamais touchées. Les diffs viennent de la comparaison des deux instantanés. L’annulation restaure l’instantané « avant », et demande d’abord si un fichier a de nouveau changé entre-temps. Le pont ne committe et ne prépare jamais rien de lui-même. Un commit n’a lieu que lorsque vous cliquez sur Commit, et seulement pour les fichiers de cette session : il est construit dans un index privé à partir de votre dernier commit et de ces fichiers tels que la session les a laissés, votre branche ne bouge que si elle est toujours là où elle était, et dans votre zone de préparation seules les entrées de ces fichiers changent, donc ils apparaissent propres et tout ce que vous aviez préparé d’autre reste tel quel. Un fichier que vous aviez modifié avant la session est listé et laissé de côté sauf si vous le cochez, et rien n’est committé si un fichier a changé depuis la session. C’est git lui-même qui committe, donc vos hooks se lancent (pre-commit ne voit que ces fichiers préparés, et commit-msg peut changer le message) et les commits sont signés si vous avez réglé git pour les signer. Si un hook échoue, rien n’est committé et sa sortie est affichée.
- **L’application** (`web/`, construite avec Vite, React et TypeScript) est la carte que vous utilisez. Elle est servie sur leagueofagents.dev et par le pont lui-même.

Plus de détails dans [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Développement

```bash
npm --prefix web ci
npm --prefix web run build
cd ~/code/your-project
node ~/code/league-of-agents/bridge/loa.mjs
```

Pour héberger votre propre copie de l’application, déployez le dépôt sur Vercel (`vercel.json` configure la compilation), ajoutez votre domaine, et démarrez le pont avec `--web https://your-domain`.

| Variable | Par défaut | Ce qu’elle fait |
|---|---|---|
| `LOA_WEB_DIR` | `web/dist` | Application compilée que sert le pont |
| `LOA_WEB_FILE` | aucune | Servir un seul fichier HTML à la place |

## Contribuer

Consultez [CONTRIBUTING.md](CONTRIBUTING.md). Les contributions sont acceptées sous la licence Apache 2.0, et chacun suit le [code de conduite](CODE_OF_CONDUCT.md).

## Licence

[Apache 2.0](LICENSE)
