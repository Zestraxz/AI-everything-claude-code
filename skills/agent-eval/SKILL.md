---
name: agent-eval
description: Head-to-head comparison of coding agents (Claude Code, Aider, Codex, etc.) on custom tasks with pass rate, cost, time, and consistency metrics. Use when choosing between coding agents, or when a change to an agent setup needs measured pass rate, cost, and time rather than an impression.
license: MIT
metadata:
  origin: ECC
tools: Read, Write, Edit, Bash, Grep, Glob
---

# Agent Eval Skill

A lightweight CLI tool for comparing coding agents head-to-head on reproducible tasks. Every "which coding agent is best?" comparison runs on vibes — this tool systematizes it.

## When to Activate

- Comparing coding agents (Claude Code, Aider, Codex, etc.) on your own codebase
- Measuring agent performance before adopting a new tool or model
- Running regression checks when an agent updates its model or tooling
- Producing data-backed agent selection decisions for a team

## How It Works

1. **Tasks are YAML fixtures.** Each task names a repo, a pinned commit, the files in scope, the prompt to give the agent, and one or more judges. Because the commit is pinned, the same task can be replayed weeks later.
2. **Every run is isolated.** For each agent and each trial, the tool creates a fresh git worktree from the pinned commit, hands the prompt to the agent, and lets it edit only that worktree. No Docker, no shared state between runs.
3. **Judges decide pass or fail.** Deterministic judges (`pytest`, a build command) run first, pattern judges (`grep`) check for expected code shapes, and an optional LLM judge scores what the deterministic checks cannot express.
4. **Metrics are recorded per trial.** Pass or fail, wall-clock time, and API cost where the agent reports it. Repeating trials turns pass or fail into a consistency percentage.
5. **The report aggregates.** `agent-eval report` groups trials by agent and task and prints pass rate, cost, time, and consistency side by side.

The sections below cover each piece: task definitions and isolation under Core Concepts, the run loop under Workflow, and the judge catalogue under Judge Types.

## Installation

> **Note:** Install agent-eval from its repository after reviewing the source.

## Core Concepts

### YAML Task Definitions

Define tasks declaratively. Each task specifies what to do, which files to touch, and how to judge success:

```yaml
name: add-retry-logic
description: Add exponential backoff retry to the HTTP client
repo: ./my-project
files:
  - src/http_client.py
prompt: |
  Add retry logic with exponential backoff to all HTTP requests.
  Max 3 retries. Initial delay 1s, max delay 30s.
judge:
  - type: pytest
    command: pytest tests/test_http_client.py -v
  - type: grep
    pattern: "exponential_backoff|retry"
    files: src/http_client.py
commit: "abc1234"  # pin to specific commit for reproducibility
```

### Git Worktree Isolation

Each agent run gets its own git worktree — no Docker required. This provides reproducibility isolation so agents cannot interfere with each other or corrupt the base repo.

### Metrics Collected

| Metric | What It Measures |
|--------|-----------------|
| Pass rate | Did the agent produce code that passes the judge? |
| Cost | API spend per task (when available) |
| Time | Wall-clock seconds to completion |
| Consistency | Pass rate across repeated runs (e.g., 3/3 = 100%) |

## Workflow

### 1. Define Tasks

Create a `tasks/` directory with YAML files, one per task:

```bash
mkdir tasks
# Write task definitions (see template above)
```

### 2. Run Agents

Execute agents against your tasks:

```bash
agent-eval run --task tasks/add-retry-logic.yaml --agent claude-code --agent aider --runs 3
```

Each run:
1. Creates a fresh git worktree from the specified commit
2. Hands the prompt to the agent
3. Runs the judge criteria
4. Records pass/fail, cost, and time

### 3. Compare Results

Generate a comparison report:

```bash
agent-eval report --format table
```

```
Task: add-retry-logic (3 runs each)
┌──────────────┬───────────┬────────┬────────┬─────────────┐
│ Agent        │ Pass Rate │ Cost   │ Time   │ Consistency │
├──────────────┼───────────┼────────┼────────┼─────────────┤
│ claude-code  │ 3/3       │ $0.12  │ 45s    │ 100%        │
│ aider        │ 2/3       │ $0.08  │ 38s    │  67%        │
└──────────────┴───────────┴────────┴────────┴─────────────┘
```

## Judge Types

### Code-Based (deterministic)

```yaml
judge:
  - type: pytest
    command: pytest tests/ -v
  - type: command
    command: npm run build
```

### Pattern-Based

```yaml
judge:
  - type: grep
    pattern: "class.*Retry"
    files: src/**/*.py
```

### Model-Based (LLM-as-judge)

```yaml
judge:
  - type: llm
    prompt: |
      Does this implementation correctly handle exponential backoff?
      Check for: max retries, increasing delays, jitter.
```

## Examples

### Example 1: Choosing between two agents for a codebase

Three representative tasks, three trials each, two agents:

```bash
agent-eval run --task tasks/add-retry-logic.yaml --task tasks/fix-n-plus-one.yaml --task tasks/add-cli-flag.yaml \
  --agent claude-code --agent aider --runs 3
agent-eval report --format table
```

Read the report for consistency first, then pass rate, then cost. An agent that passes 3/3 on every task at a slightly higher cost is usually the safer pick than one that passes 2/3 cheaply, because the failed third would have cost a human review cycle.

### Example 2: Regression check after a model update

Keep the task set and run only the agent whose model or tooling changed. The pinned commit keeps the baseline stable:

```bash
agent-eval run --task tasks/*.yaml --agent claude-code --runs 3
agent-eval report --format table
```

Compare the new table against the one saved from the previous run. A drop in consistency on any task is the signal to investigate before rolling the update out to the team.

### Example 3: A task with a deterministic and an LLM judge

```yaml
name: paginate-list-endpoint
repo: ./api
commit: "9f2e1c0"
files:
  - src/routes/items.py
prompt: |
  Add cursor-based pagination to GET /items with a default page size of 50.
judge:
  - type: pytest
    command: pytest tests/test_items.py -v
  - type: llm
    prompt: |
      Does the endpoint return an opaque cursor and stop when there are no more items?
```

The pytest judge guards correctness; the LLM judge catches designs that pass the tests but expose raw offsets as cursors.

## Best Practices

- **Start with 3-5 tasks** that represent your real workload, not toy examples
- **Run at least 3 trials** per agent to capture variance — agents are non-deterministic
- **Pin the commit** in your task YAML so results are reproducible across days/weeks
- **Include at least one deterministic judge** (tests, build) per task — LLM judges add noise
- **Track cost alongside pass rate** — a 95% agent at 10x the cost may not be the right choice
- **Version your task definitions** — they are test fixtures, treat them as code

## Links

- Repository: [github.com/joaquinhuigomez/agent-eval](https://github.com/joaquinhuigomez/agent-eval)
