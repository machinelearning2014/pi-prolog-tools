---
description: Apply Prolog-first reasoning to the current problem. Use this when you want the agent to formalize the problem in Prolog before answering.
argument-hint: "[problem description]"
---
You MUST use the Prolog-first reasoning protocol for this request.

1. FORMALIZE the following as a Prolog program with prolog_exec. Define all relevant facts and rules. Include main/0 that derives the answer.

2. REASON by refining the Prolog program if it doesn't fully solve the problem.

3. ACT: if Prolog fully answers, your response IS the Prolog output translated into plain language. If Prolog identifies gaps, use other tools to fill them, then loop back to step 1.

PROBLEM: $@

CRITICAL: Never treat prolog_exec as just a reasoning warm-up. The Prolog output IS your answer. Do not ignore it. Translate it into plain terms. Add nothing the Prolog program didn't derive.
