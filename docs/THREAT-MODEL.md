# Threat model

League of Agents runs a small local server, the bridge, inside a git repo on your machine. This page says what the bridge can do, who can reach it, what protects it, and what it doesn't defend against.

## What the bridge can do
- Read every file in the repo it was started in, and show it on the map.
- Write files there: saving an edit from the editor, and reverting a run.
- Start the agent CLIs installed on this machine (Claude Code, Codex) inside the repo, with the prompt and scope you give.
- Snapshot the working tree into private `refs/loa/` refs. It never commits to your branch, moves HEAD or touches staging.
- With your consent, add hooks to Claude Code's and Codex's settings in the repo and to your own `~/.cursor/hooks.json`. Each hook runs `.loa/bridge.mjs` when you send a prompt.

Whoever can call its API can do all of this, so the API is the thing to protect.

## Who can reach it
- It listens on `127.0.0.1` only. Other machines can't connect.
- Programs on this machine can connect. Each needs the token for the API.
- Web pages in your browser can send requests to `127.0.0.1`. That is the case the checks below are for.

## What protects it
- **A token.** 24 random characters, new on every start. It is printed in the terminal, kept in `.loa/bridge.json`, and travels in the link's `#t=` fragment, which browsers never send to a server. The app sends it only in the `Authorization` header; a token in a URL is refused, so it can't leak into logs or history.
- **The Host header.** It must be `127.0.0.1:<port>` or `localhost:<port>`. A page on another name that points at 127.0.0.1 (DNS rebinding) sends its own name, and gets 403.
- **The Origin header.** A browser always says which site a script runs on. Only these may call the API: the app the bridge serves itself, the hosted app it links to (`https://leagueofagents.dev`, or what `--web` sets), and this project's Vercel deployments. Every other site gets 403 before the token is read, preflight requests included. CORS headers go only to those sites.
- **No form or image tricks.** A request a page makes with no Origin (an image, a link, a form) carries `Sec-Fetch-Site: cross-site`, and gets 403 on the API.
- **Lockout.** A wrong token is answered more slowly each time: 100 ms, doubling up to 5 s. After 50 wrong tokens the API answers 423 to everyone until the bridge restarts, and its log and `npx leagueofagents-cli@latest status` say so. The token is far too long to guess; the lockout also stops repeated tries from a program on this machine.
- **The token's folder is private.** `.loa/`, where `bridge.json` and the bridge's log keep the token, is set to be readable by your account only (0700) at every start, so other accounts on the machine can't read it.
- **No secrets in snapshots.** Untracked `.env` and `.env.*` files never enter a snapshot.

## What League of Agents doesn't defend against
- **Anything already running as you.** A program running under your account can read `.loa/bridge.json` (the token), your agent settings and the repo itself. The bridge can't protect against it, and neither can any local tool.
- **A changed `.loa/bridge.mjs`.** The hooks run this file on every prompt, and Cursor's run it for every workspace. Anyone who can write to the repo's `.loa/` folder can run code when you send a prompt. It has your user's permissions, like the repo's own scripts.
- **What the agent does.** Agents run with their own permissions. The scope lock blocks Claude Code's edits outside the scope while a run is live. For other agents it only reports them afterwards. Review each run before keeping it.
- **A trusted site that is compromised.** If leagueofagents.dev or a deployment of this project served harmful code, that code could call your bridge while it runs with your token in the page.
- **Shared machines.** Other people's accounts on the same machine can reach `127.0.0.1`. They still need the token, and `.loa/` is closed to them. Your repository's own files are as open to them as your folder permissions make them.

## Reporting a problem
See `SECURITY.md`.
