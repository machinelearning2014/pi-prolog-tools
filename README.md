# pi-prolog-tools

Prolog-first reasoning toolkit for [pi](https://github.com/badlogic/pi-coding-agent) — a coding agent harness.

Adds four custom tools (`python_exec`, `prolog_exec`, `web_search`, `web_browse`), two skills, and a reasoning protocol that makes the agent formalize every problem in Prolog before answering.

## Install

```bash
pi install git:github.com/machinelearning2014/pi-prolog-tools
```

### Prerequisites

| Tool | Required For | Install |
|---|---|---|
| **Python 3** | `python_exec` | `brew install python3` / `apt install python3` |
| **SWI-Prolog** | `prolog_exec` | `brew install swi-prolog` / `apt install swi-prolog` |
| **Playwright Chromium** | `web_browse` | `npx playwright install chromium` |

Missing binaries are handled gracefully — the tools return clear errors telling users what to install.

## What's Included

### Custom Tools

| Tool | Description |
|---|---|
| `python_exec` | Sandboxed Python execution with pre-imported numpy, scipy, sympy, sklearn |
| `prolog_exec` | Isolated SWI-Prolog execution — each call is stateless, must include `main/0` |
| `web_search` | Web search via Brave, LangSearch API, or DuckDuckGo (auto-fallback) |
| `web_browse` | Headless browser page fetching with CSS selector support |

### Skills

| Skill | Description |
|---|---|
| `prolog-first-reasoning` | Protocol: FORMALIZE in Prolog → REASON by refining → ACT (translate output or fill gaps) |
| `prolog-syntax` | Prolog coding rules for `prolog_exec` — clause termination, validation templates, data integrity |

### Prompt Template

| Command | Description |
|---|---|
| `/prolog [problem]` | Force Prolog-first reasoning on a specific query |

### Reasoning Protocol (System Prompt)

The extension automatically injects the Prolog-first reasoning protocol into every system prompt. The agent will:

1. **FORMALIZE** — Write a complete Prolog program with `prolog_exec`
2. **REASON** — Refine until Prolog derives the answer or identifies gaps
3. **ACT** — If Prolog solved it: respond in plain language from Prolog output. If gaps found: use other tools to fill them, then loop back to step 1

A refresher is re-injected every 3 turns to keep the agent on track.

## Enable/Disable Specific Parts

Use pi's built-in `/tools` command to toggle individual tools on and off interactively.

To disable an entire extension while keeping the package installed, use `settings.json` filtering:

```json
{
  "packages": [
    {
      "source": "git:github.com/machinelearning2014/pi-prolog-tools",
      "extensions": ["extensions/compute-tools.ts"],
      "skills": [],
      "prompts": []
    }
  ]
}
```

This example keeps only `python_exec` + `prolog_exec` + the reasoning directive, without web tools, skills, or prompt templates.

## Package Structure

```
pi-prolog-tools/
├── extensions/
│   ├── compute-tools.ts      # python_exec, prolog_exec, reasoning directive
│   ├── web-tools.ts          # web_search, web_browse registration
│   ├── web-search.ts         # Search backends (Brave → LangSearch → DuckDuckGo)
│   ├── web-browse.ts         # Browser fetch via Playwright
│   └── sandbox_python.py     # Python subprocess sandbox
├── skills/
│   ├── prolog-first-reasoning/SKILL.md
│   └── prolog-syntax/SKILL.md
├── prompts/
│   └── prolog.md             # /prolog template
└── package.json
```

## Example Session

```
User: Is Donald Trump the worst president in US history?

Agent:
  → FORMALIZE: prolog_exec with scholarly survey data
  → REASON: Prolog identifies Trump as the only president ranked #45
    AND in bottom 5 of all major surveys AND twice impeached with felony conviction
  → ACT: Responds with plain-language analysis derived from Prolog output
```

## License

MIT
