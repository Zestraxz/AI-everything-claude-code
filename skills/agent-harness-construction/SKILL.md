---
name: agent-harness-construction
description: Design and optimize AI agent action spaces, tool definitions, and observation formatting for higher completion rates. Use when defining or revising an agent's tool set, action space, or observation format.
metadata:
  origin: ECC
---

# Agent Harness Construction

Use this skill when you are improving how an agent plans, calls tools, recovers from errors, and converges on completion.

## When to Use

- Defining the tool set for a new agent, or deciding whether one tool should be split or merged
- Completion rate or pass@1 is low and the failures trace back to wrong tool choice, misread output, or retry loops
- Tool responses are free-form text that the agent has to parse or guess at
- The system prompt keeps growing and the agent forgets early instructions
- Choosing between ReAct, function-calling, or a hybrid loop for a new workflow

Do not use for prompt wording alone, or for debugging a single failing run; use `agent-introspection-debugging` for that.

## How It Works

Treat the harness as four constraints on agent quality and tighten them in order:

1. **Action space.** Give the agent stable, explicit tools with narrow schema-first inputs and deterministic output shapes. Split high-risk operations into micro-tools and keep common read, edit, and search loops at medium granularity.
2. **Observations.** Make every tool return the same envelope (`status`, `summary`, `next_actions`, `artifacts`) so the model never has to parse prose to learn what happened or what to do next.
3. **Recovery.** Give every error path a root-cause hint, a safe retry instruction, and an explicit stop condition, so failures end in a decision rather than a loop.
4. **Context budget.** Keep the system prompt minimal and invariant, load guidance through skills on demand, reference files instead of inlining them, and compact at phase boundaries.

Pick the loop architecture last: ReAct for exploratory work, function-calling for deterministic flows, or the hybrid of ReAct planning with typed tool execution for most production agents. Then benchmark completion rate, retries per task, pass@1 and pass@3, and cost per successful task, and iterate on whichever constraint the failures point at.

## Core Model

Agent output quality is constrained by:
1. Action space quality
2. Observation quality
3. Recovery quality
4. Context budget quality

## Action Space Design

1. Use stable, explicit tool names.
2. Keep inputs schema-first and narrow.
3. Return deterministic output shapes.
4. Avoid catch-all tools unless isolation is impossible.

## Granularity Rules

- Use micro-tools for high-risk operations (deploy, migration, permissions).
- Use medium tools for common edit/read/search loops.
- Use macro-tools only when round-trip overhead is the dominant cost.

## Observation Design

Every tool response should include:
- `status`: success|warning|error
- `summary`: one-line result
- `next_actions`: actionable follow-ups
- `artifacts`: file paths / IDs

## Error Recovery Contract

For every error path, include:
- root cause hint
- safe retry instruction
- explicit stop condition

## Context Budgeting

1. Keep system prompt minimal and invariant.
2. Move large guidance into skills loaded on demand.
3. Prefer references to files over inlining long documents.
4. Compact at phase boundaries, not arbitrary token thresholds.

## Architecture Pattern Guidance

- ReAct: best for exploratory tasks with uncertain path.
- Function-calling: best for structured deterministic flows.
- Hybrid (recommended): ReAct planning + typed tool execution.

## Benchmarking

Track:
- completion rate
- retries per task
- pass@1 and pass@3
- cost per successful task

## Examples

### Example 1: Observation envelope for a search tool

```json
{
  "status": "success",
  "summary": "3 files match 'retryWithBackoff'",
  "next_actions": ["Read src/http/retry.ts to see the current implementation"],
  "artifacts": ["src/http/retry.ts", "src/http/client.ts", "tests/retry.test.ts"]
}
```

The agent can act on `next_actions` and `artifacts` directly instead of re-reading a wall of grep output.

### Example 2: Error path with a recovery contract

```json
{
  "status": "error",
  "summary": "Migration failed: relation \"orders\" already exists",
  "root_cause_hint": "A previous run applied 0042_orders.sql without recording it",
  "safe_retry": "Run `migrate status` and mark 0042 as applied, then re-run `migrate up`",
  "stop_condition": "If `migrate status` shows 0042 applied and the error persists, stop and report; do not drop the table"
}
```

Without the stop condition the agent would keep retrying the same migration or, worse, try to drop the table.

### Example 3: Splitting a catch-all tool by risk

Before: one `run_shell` tool used for reading files, searching, running tests, and deploying.

After:

| Tool | Granularity | Reason |
|------|-------------|--------|
| `read_file`, `search_code` | medium | common loop, low risk |
| `run_tests` | medium | deterministic, safe to retry |
| `deploy_service` | micro | high risk, needs its own schema, confirmation, and stop condition |

The agent keeps `run_shell` only as a fallback with an explicit warning in its description, and pass@1 on deployment tasks rises because the model can no longer reach production through a generic command.

## Anti-Patterns

- Too many tools with overlapping semantics.
- Opaque tool output with no recovery hints.
- Error-only output without next steps.
- Context overloading with irrelevant references.
