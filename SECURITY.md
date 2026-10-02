# Security

League of Agents runs a local server, the bridge, inside your repository. It can read and write files there and start the coding agents installed on your machine. What it protects and what it doesn't is in [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).

## Reporting a vulnerability

Please report it privately, not in a public issue: use **Report a vulnerability** on this repository's **Security** tab (GitHub's private vulnerability reporting). Include what you found, how to reproduce it, and what an attacker could do with it.

You'll get a reply confirming the report and updates until it is fixed. The release notes credit you unless you'd rather not be named.

## Supported versions

Fixes go into the latest release of `leagueofagents-cli` on npm and into leagueofagents.dev. Update with `npx leagueofagents-cli@latest`; the app asks you to when your bridge is too old.

## In scope
- The bridge (`bridge/loa.mjs`): its API, the token, the Host and Origin checks, hooks, snapshots and reverts.
- The web app, including what it sends to the bridge.

Out of scope: problems that need someone already running code as you on your machine, and the coding agents themselves.
