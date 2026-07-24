---
name: prolog-syntax
description: Prolog coding rules for prolog_exec. Use when writing Prolog programs to prevent syntax errors.
---

# Prolog Syntax Rules

## Critical: Clause Termination

Every prolog_exec program MUST end with a period (`.`) after the final goal in `main/0`.

The Prolog clause terminator is period + whitespace/EOF. When missing, SWI-Prolog reports `Syntax error: Unexpected end of file` — the output IS still valid, but the error pollutes results.

## Required Template

Always end `main/0` with `, true.`:

```prolog
main :-
    % YOUR GOALS HERE
    final_goal(Args),
    true.
```

The comma before `true` is mandatory. Without it, `true.` becomes a separate fact and the clause body remains unterminated.

## Common Failure

The period inside a string is NOT a clause terminator:

```prolog
% WRONG:
main :- writeln('Done.')

% CORRECT:
main :- writeln('Done.'), true.
```

## Data Integrity Rules

### Never Hardcode Numbers in Output

Always compute totals from the data. Hardcoded numbers drift out of sync.

```prolog
% WRONG:
format('Rank: ~w out of 44~n', [R]).

% CORRECT:
findall(_, president_ranking(_,_), All), length(All, Total),
format('Rank: ~w out of ~w~n', [R, Total]).
```

### Always Validate Facts Before Reasoning

Gate `main/0` behind `validate_all/0`. At minimum check:
- No duplicate entries
- No gaps in a sequential key (ranking, ordering, ID)
- Expected count matches actual count

```prolog
main :- validate_all, !, actual_main.
```

The cut (`!`) prevents proceeding if validation fails.

### Validation Predicate Templates (inline these in every program)

These MUST be inlined — prolog_exec cannot import files. The predicates are fully generic; just pass your predicate name.

```prolog
% Generic validation helpers (copy these verbatim into every program)

check_dup(Pred, ArgPos, Label) :-
    (ArgPos = 1 -> Goal =.. [Pred, X, _]
    ; ArgPos = 2 -> Goal =.. [Pred, _, X]
    ),
    findall(X, Goal, Values),
    sort(Values, Sorted),
    length(Values, L1), length(Sorted, L2),
    (L1 \= L2 ->
        format('FAIL: Duplicate ~w in ~w/2~n', [Label, Pred]), fail
    ; format('  PASS: all ~w unique (~w items)~n', [Label, L1])).

check_gaps(Pred, ArgPos) :-
    (ArgPos = 1 -> Goal =.. [Pred, X, _]
    ; ArgPos = 2 -> Goal =.. [Pred, _, X]
    ),
    findall(X, Goal, Values),
    max_list(Values, Max),
    findall(N, between(1, Max, N), Expected),
    sort(Values, Sorted),
    (Expected \= Sorted ->
        ord_subtract(Expected, Sorted, Missing),
        format('FAIL: Gaps in arg ~w of ~w/2~n', [ArgPos, Pred]),
        format('  Missing: ~w~n', [Missing]), fail
    ; format('  PASS: arg ~w contiguous 1..~w~n', [ArgPos, Max])).

check_count(Pred, Arity, Expected) :-
    length(Args, Arity),
    Goal =.. [Pred | Args],
    findall(_, Goal, All),
    length(All, Actual),
    (Actual \= Expected ->
        format('FAIL: Expected ~w facts for ~w/~w, got ~w~n',
               [Expected, Pred, Arity, Actual]), fail
    ; format('  PASS: ~w/~w count = ~w~n', [Pred, Arity, Actual])).

% Wire them together for YOUR specific predicate:
% validate_all :-
%     format('--- Data Integrity Checks ---~n', []),
%     check_dup(mypred, 1, 'names'),
%     check_dup(mypred, 2, 'ranks'),
%     check_gaps(mypred, 2),
%     check_count(mypred, 2, 44),
%     format('All checks passed.~n~n', []).
```

For 1-arg predicates, see `validate.pl` for `check_dup_1/2` and `check_gaps_1/1`. The file is a reference; predicates still must be inlined.

### Cross-Reference Facts Before Trusting Memory

When entering facts from memory, verify against a live source BEFORE writing the Prolog program:
```
web_search("<topic> authoritative data")
```

## Pre-Call Checklist

1. Does main/0 end with `, true.`?
2. Is there a `,` before `true`?
3. Does main/0 gate behind `validate_all/0` with a cut?
4. Are all numbers in format strings computed, not hardcoded?
5. Were facts cross-referenced against an external source?
6. Are the validation predicates inlined (not relying on an external file)?
7. If output appears with an error, use the output — the program ran.
