---
name: prolog-first-reasoning
description: Prolog-first reasoning protocol. Formalize problems in Prolog before answering. Use for logical reasoning, analysis, and multi-step problem solving.
---

# Prolog-First Reasoning Protocol

Before answering any question, formalize it as a Prolog program. Use `prolog_exec` to model the problem: facts, rules, and a `main/0` that derives the answer.

## The Protocol

### 0. VALIDATE (new — always run before reasoning)
Before trusting any Prolog output, embed data integrity checks in the program:
- Gate `main/0` behind `validate_all/0` with a cut: `main :- validate_all, !, actual_main.`
- Check for: duplicate entries, gaps in sequential keys, expected vs actual count.
- If facts were entered from memory, cross-reference against a live source via `web_search`.
- Never hardcode a total in a `format` string — always compute it from the data.
- Inline validation predicates directly — prolog_exec cannot import files. See `prolog-syntax` skill for the copy-paste templates.

### 1. FORMALIZE
Call `prolog_exec` with a complete program expressing the problem. Define all relevant facts and rules. Include `main/0` that prints the derived answer.

### 2. REASON
If the first Prolog run doesn't fully solve it, analyze the output, refine the rules, and call `prolog_exec` again. Loop until Prolog derives a complete answer OR you determine Prolog alone cannot solve it.

### 3. ACT
Two outcomes at this point:

**(a) Prolog fully answered the question:** Your response IS the Prolog output, but translated into plain, accessible language. Do not just echo Prolog syntax or jargon. Explain what the derivation means in everyday terms a non-programmer would understand. The Prolog reasoning is your backbone; the plain-terms translation is your response. Do not add ideas the Prolog program did not derive.

**(b) Prolog identified a gap** (missing data, need to read files, need computation): Use other tools (read, bash, edit, write, web_search, web_browse, python_exec) to fill the gap, then loop back to Step 1 with new facts.

## Critical Rules

- Never treat `prolog_exec` as just a reasoning warm-up. The Prolog output IS your answer when it fully addresses the request.
- Do not ignore Prolog output and write your own response on top of it.
- When Prolog finds a gap, the gap is real — fill it with evidence, not speculation.
- Always use the Prolog template: end `main/0` with `, true.`

## Integration

- **Prolog as reasoning backbone:** Use `prolog_exec` to derive logical consequences, check consistency, and plan multi-step actions.
- **Tools for interaction:** Use read/bash/edit/write to inspect and modify files.
- **Python for computation:** Use `python_exec` for numerical work, symbolic math, or data processing beyond Prolog's scope.
- **Web for current facts:** Use `web_search` and `web_browse` for information beyond training cutoff.
- **Feedback loop:** Tool results that reveal new facts should be re-formalized in a follow-up `prolog_exec` before acting further.
