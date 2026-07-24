/**
 * Prolog Compute Tools — python_exec + prolog_exec + reasoning directive
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SANDBOX_PY = join(__dirname, "sandbox_python.py");

function findSwipl(): string {
  for (const c of [
    "/opt/homebrew/bin/swipl",
    "/usr/local/bin/swipl",
    "/usr/bin/swipl",
    "swipl",
  ]) {
    if (existsSync(c) || c === "swipl") return c;
  }
  return "swipl";
}

function findPython3(cwd: string): string {
  const venv = join(cwd, ".venv", "bin", "python3");
  if (existsSync(venv)) return venv;
  return "python3";
}

function spawnWithTimeout(
  cmd: string, args: string[],
  opts: { timeout: number; signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } });
    let stdout = "", stderr = "", settled = false;
    proc.stdout?.on("data", (c: Buffer) => (stdout += c.toString()));
    proc.stderr?.on("data", (c: Buffer) => (stderr += c.toString()));
    const timer = setTimeout(() => {
      if (settled) return; settled = true;
      proc.kill("SIGKILL"); resolve({ stdout, stderr, exitCode: -1 });
    }, opts.timeout * 1000);
    const onAbort = () => {
      if (settled) return; settled = true;
      clearTimeout(timer); proc.kill("SIGKILL");
      resolve({ stdout, stderr, exitCode: -1 });
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    proc.on("close", (code) => {
      if (settled) return; settled = true;
      clearTimeout(timer); opts.signal?.removeEventListener("abort", onAbort);
      resolve({ stdout, stderr, exitCode: code ?? -1 });
    });
    proc.on("error", (e: Error & { code?: string }) => {
      if (settled) return; settled = true;
      clearTimeout(timer);
      resolve({ stdout: "", stderr: `Binary not found: ${cmd}`, exitCode: e.code === "ENOENT" ? -2 : -1 });
    });
  });
}

function filterPrologWarnings(stderr: string): string {
  return stderr.split("\n").filter(l => {
    const s = l.trim();
    return s && !s.startsWith("Warning:") && !/^\s*\S+\.pl:\d+:/.test(s) && /ERROR/i.test(s);
  }).join("\n");
}

export default function (pi: ExtensionAPI) {
  let turnCount = 0;

  pi.on("turn_end", () => { turnCount++; });

  // ── Prolog-First System Prompt Injection ──────────────────────────
  pi.on("before_agent_start", async (event) => {
    const { selectedTools, cwd } = event.systemPromptOptions;
    const piTools = selectedTools.filter(t => ["read","bash","edit","write"].includes(t)).join(", ");
    const projectName = cwd.split("/").pop() || cwd;

    const directive = [
      "## Prolog-First Reasoning (Pi-Integrated)",
      "",
      `You are an expert coding agent. Project: ${projectName}.`,
      "",
      "### Reasoning Protocol",
      "",
      "Before answering, formalize the user's request as a Prolog program.",
      "Use prolog_exec to model the problem: facts, rules, and main/0.",
      "",
      "1. **FORMALIZE** — Call prolog_exec with a complete program.",
      "2. **REASON** — Refine if needed; loop until Prolog solves it or you",
      "   determine Prolog alone cannot solve it.",
      "3. **ACT** — (a) If Prolog solved it: your response IS the Prolog output,",
      "   translated into plain language. Do not add ideas Prolog didn't derive.",
      "   (b) If Prolog found a gap: use other tools (" + (piTools || "read/bash/edit/write") + ")",
      "   to fill it, then loop back to step 1.",
      "",
      "CRITICAL: Prolog output IS your answer when it fully addresses the",
      "request. Do not ignore it and write your own response on top of it.",
      "",
      "### Tool Integration",
      "",
      "- **Prolog as reasoning backbone**: derive logical consequences.",
      "- **Pi tools**: read/bash/edit/write for file interaction.",
      "- **Python**: python_exec for numerical work, symbolic math, data processing.",
      "- **Feedback loop**: new facts → re-formalize in prolog_exec before acting.",
    ].join("\n");

    const refresher = (turnCount > 0 && turnCount % 3 === 0)
      ? "\n\n--- PROLOG-FIRST REFRESHER ---\n1. FORMALIZE (prolog_exec). 2. REASON (refine). 3. ACT (fill gaps only).\nThe Prolog output IS your answer — translate plainly, add nothing new.\n--- END REFRESHER ---"
      : "";

    return { systemPrompt: event.systemPrompt + "\n" + directive + refresher };
  });

  // ── python_exec ─────────────────────────────────────────────────
  pi.registerTool({
    name: "python_exec",
    label: "Python Exec",
    description: "Execute Python code in a sandboxed environment. Pre-imported: math, sympy, numpy (as np), scipy, sklearn. Stdlib: itertools, statistics, collections, functools, heapq, fractions, decimal, random, json. Use print() for output.",
    parameters: Type.Object({ code: Type.String({ description: "Python code to execute. Use print() for output." }) }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const tmpPath = join(tmpdir(), `pi_py_${randomBytes(8).toString("hex")}.py`);
      await writeFile(tmpPath, params.code, "utf-8");
      try {
        const { stdout, stderr, exitCode } = await spawnWithTimeout(
          findPython3(ctx.cwd), [SANDBOX_PY, tmpPath], { timeout: 30, signal });
        try {
          const r = JSON.parse(stdout.trim() || "{}");
          const display = r.error
            ? `## Python Error\n**Error:** ${r.error}\n${r.output ? "**Output:**\n```\n" + r.output + "\n```" : ""}`
            : r.output ? `## Python Output\n\n\`\`\`\n${r.output}\n\`\`\`` : "(no output)";
          return { content: [{ type: "text", text: display }], details: { success: r.success ?? false, output: r.output, error: r.error } };
        } catch {
          const display = stderr ? `## Python Error\n**Error:** ${stderr}` : `## Python Output\n\n\`\`\`\n${stdout}\n\`\`\``;
          return { content: [{ type: "text", text: display }], details: { success: exitCode === 0 } };
        }
      } finally { await unlink(tmpPath).catch(() => {}); }
    },
  });

  // ── prolog_exec ─────────────────────────────────────────────────
  pi.registerTool({
    name: "prolog_exec",
    label: "Prolog Exec",
    description: "Execute a self-contained Prolog program. Each call isolated. Include ALL predicates/facts. Must include main/0. Use ASCII, uppercase variables.",
    parameters: Type.Object({ code: Type.String({ description: "Prolog code. Must include main/0." }) }),
    async execute(_id, params, signal) {
      const program = `:- encoding(utf8).\n\n${params.code}\n`;
      const tmpPath = join(tmpdir(), `pi_pl_${randomBytes(8).toString("hex")}.pl`);
      await writeFile(tmpPath, program, "utf-8");
      try {
        const goal = "catch(call_with_time_limit(25,(main)),Error,(Error==time_limit_exceeded->write('TIMEOUT'),nl;write('ERROR: '),write(Error),nl)),flush_output,halt";
        const { stdout, stderr } = await spawnWithTimeout(
          findSwipl(), ["-q", "-f", tmpPath, "-g", goal], { timeout: 30, signal });
        const filtered = filterPrologWarnings(stderr);
        const output = stdout.trim();
        const hasErr = output.includes("ERROR:") || output === "TIMEOUT" || !!filtered;
        const errMsg = output === "TIMEOUT" ? "Timed out" : filtered || (output.includes("ERROR:") ? output : "");
        const display = hasErr ? `## Prolog Error\n**Error:** ${errMsg}\n\n**Output:**\n\`\`\`\n${output}\n\`\`\`` : output ? `## Prolog Output\n\n\`\`\`\n${output}\n\`\`\`` : "true.";
        return { content: [{ type: "text", text: display }], details: { success: !hasErr, output, error: errMsg } };
      } finally { await unlink(tmpPath).catch(() => {}); }
    },
  });
}
