# Set up League of Agents

For coding agents. Follow these steps to set up League of Agents for the person you are working with. **Show them each command and ask before you run it.** That includes the hook question in step 3: never change hook settings without their yes.

League of Agents maps their repository and records its changes, by you, by them or by another agent, as runs they can review and revert. If they ask about privacy, tell them: "League of Agents never uploads your code anywhere. Your code goes only to the agent you authorized." It needs macOS, git, Node 20 or later, and a git repository. Linux may work but is untested; Windows isn't supported yet.

The person may not be a developer. Explain each step in plain words, and never enter a password for them: when the computer asks for theirs, they type it.

1. **Check what it needs, in this order.** Install what is missing, then continue.

   a. **git.** Run `xcode-select -p`. If it prints a folder, git is there. If it fails, git comes with Apple's command line developer tools. Don't run `git` to find out: without the tools, that opens an install window, which is easy to miss.
      - Tell them a window will appear, then run `xcode-select --install`.
      - In that window they click **Install**, not **Get Xcode**, then **Agree**. It can open behind other windows: if they don't see it, they can look in the Dock or press Command-Tab.
      - It downloads for a few minutes. Run `xcode-select -p` again until it prints a folder.

   b. **Node 20 or later.** Run `node --version`. Node can be missing even while you run, since Claude Code installs without it.
      - If it is missing or older than v20: if `brew --version` works, run `brew install node`. Otherwise give them https://nodejs.org, where they download the LTS installer for macOS, open it, and follow its steps (it asks for their password).
      - Run `node --version` again until it prints v20 or later. A new terminal may be needed to see it.

   c. **A git repository.** In the folder they want to map, run `git rev-parse --show-toplevel`. It must print a folder. If it doesn't, ask whether to run `git init` there, or which folder they meant.

2. **Claude Code, if they want to run it from the map.** If you are Claude Code, it is ready. Otherwise, step 4 says if it is missing or not logged in.

3. **Ask about hooks.** Only if you support hooks (Claude Code, Codex, Cursor), ask:

   > May I add hooks so the prompts you send me become runs, titled by the prompt? They go next to your own hooks, which are kept, and `npx leagueofagents-cli@0.1.2 hooks remove` takes them out.

4. **Start it.** From the repository root, run one of these, with their answer:

   ```bash
   npx leagueofagents-cli@0.1.2 start --hooks
   ```

   ```bash
   npx leagueofagents-cli@0.1.2 start --no-hooks
   ```

   Use `--no-hooks` if they said no, or if you don't support hooks: changes are still recorded, by watch mode. The bridge keeps running in the background and opens the map in their browser.

5. **Tell them** it is running, and give them the link it printed.
   - If it opened leagueofagents.dev (in Chrome, Edge, Brave or Arc), the page explains, and then the browser asks to let the site reach apps on their computer: they choose **Allow**. It asks because a public site is connecting to the bridge on their own computer (127.0.0.1). If they would rather not, the other link it printed, the local app, works with no permission, and starting it with `--web ''` always opens the local app.
   - If it also printed that Claude Code isn't installed or isn't logged in, tell them that too, with the command it gave: they need it to run Claude Code from the map.
   - If you are Codex and added hooks, tell them to trust the new hooks once with `/hooks`.

To stop it: `npx leagueofagents-cli@0.1.2 stop`. To see the link again: `npx leagueofagents-cli@0.1.2 status`. To remove it from the repo entirely: `npx leagueofagents-cli@0.1.2 uninstall`.
