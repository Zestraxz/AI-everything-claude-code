---
name: agent-introspection-debugging
description: Structured self-debugging workflow for AI agent failures using capture, diagnosis, contained recovery, and introspection reports. Use when an agent run fails and you need a reproducible diagnosis instead of a retry.
metadata:
  origin: ECC
---

# Agent Introspection Debugging

Use this skill when an agent run is failing repeatedly, consuming tokens without progress, looping on the same tools, or drifting away from the intended task.

This is a workflow skill, not a hidden runtime. It teaches the agent to debug itself systematically before escalating to a human.

## When to Activate

- Maximum tool call / loop-limit failures
- Repeated retries with no forward progress
- Context growth or prompt drift that starts degrading output quality
- File-system or environment state mismatch between expectation and reality
- Tool failures that are likely recoverable with diagnosis and a smaller corrective action

## Scope Boundaries

Activate this skill for:
- capturing failure state before retrying blindly
- diagnosing common agent-specific failure patterns
- applying contained recovery actions
- producing a structured human-readable debug report

Do not use this skill as the primary source for:
- feature verification after code changes; use `verification-loop`
- framework-specific debugging when a narrower ECC skill already exists
- runtime promises the current harness cannot enforce automatically

## How It Works

The skill replaces blind retries with a four-phase loop that ends in a written report:

1. **Capture** the failure before touching anything: the error, the last tool sequence, the goal in progress, the current context pressure, and the environment assumptions still unverified.
2. **Diagnose** by matching the capture against known agent failure patterns (loops, context overflow, unreachable services, quota storms, state drift, wrong hypotheses) and classifying it as a logic, state, environment, or policy failure.
3. **Recover** with the smallest reversible action that would confirm or refute the diagnosis: stop retrying, trim context, verify real state, narrow to one command or test, or escalate.
4. **Report** in a fixed template so the next agent or human sees the failure, root cause, action, result, and the preventive change worth encoding.

Each phase has a checklist below. The Recovery Heuristics section orders the interventions to try, and the Output Standard section defines what a finished run must state.

## Four-Phase Loop

### Phase 1: Failure Capture

Before trying to recover, record the failure precisely.

Capture:
- error type, message, and stack trace when available
- last meaningful tool call sequence
- what the agent was trying to do
- current context pressure: repeated prompts, oversized pasted logs, duplicated plans, or runaway notes
- current environment assumptions: cwd, branch, relevant service state, expected files

Minimum capture template:

```markdown
## Failure Capture
- Session / task:
- Goal in progress:
- Error:
- Last successful step:
- Last failed tool / command:
- Repeated pattern seen:
- Environment assumptions to verify:
```

### Phase 2: Root-Cause Diagnosis

Match the failure to a known pattern before changing anything.

| Pattern | Likely Cause | Check |
| --- | --- | --- |
| Maximum tool calls / repeated same command | loop or no-exit observer path | inspect the last N tool calls for repetition |
| Context overflow / degraded reasoning | unbounded notes, repeated plans, oversized logs | inspect recent context for duplication and low-signal bulk |
| `ECONNREFUSED` / timeout | service unavailable or wrong port | verify service health, URL, and port assumptions |
| `429` / quota exhaustion | retry storm or missing backoff | count repeated calls and inspect retry spacing |
| file missing after write / stale diff | race, wrong cwd, or branch drift | re-check path, cwd, git status, and actual file existence |
| tests still failing after “fix” | wrong hypothesis | isolate the exact failing test and re-derive the bug |

Diagnosis questions:
- is this a logic failure, state failure, environment failure, or policy failure?
- did the agent lose the real objective and start optimizing the wrong subtask?
- is the failure deterministic or transient?
- what is the smallest reversible action that would validate the diagnosis?

### Phase 3: Contained Recovery

Recover with the smallest action that changes the diagnosis surface.

Safe recovery actions:
- stop repeated retries and restate the hypothesis
- trim low-signal context and keep only the active goal, blockers, and evidence
- re-check the actual filesystem / branch / process state
- narrow the task to one failing command, one file, or one test
- switch from speculative reasoning to direct observation
- escalate to a human when the failure is high-risk or externally blocked

Do not claim unsupported auto-healing actions like “reset agent state” or “update harness config” unless you are actually doing them through real tools in the current environment.

Contained recovery checklist:

```markdown
## Recovery Action
- Diagnosis chosen:
- Smallest action taken:
- Why this is safe:
- What evidence would prove the fix worked:
```

### Phase 4: Introspection Report

End with a report that makes the recovery legible to the next agent or human.

```markdown
## Agent Self-Debug Report
- Session / task:
- Failure:
- Root cause:
- Recovery action:
- Result: success | partial | blocked
- Token / time burn risk:
- Follow-up needed:
- Preventive change to encode later:
```

## Recovery Heuristics

Prefer these interventions in order:

1. Restate the real objective in one sentence.
2. Verify the world state instead of trusting memory.
3. Shrink the failing scope.
4. Run one discriminating check.
5. Only then retry.

Bad pattern:
- retrying the same action three times with slightly different wording

Good pattern:
- capture failure
- classify the pattern
- run one direct check
- change the plan only if the check supports it

## Examples

### Example 1: Loop-limit failure while fixing a test

**Capture.** The run hit the maximum tool-call limit. The last twelve calls alternate between editing `src/parser.ts` and running `npm test`, each edit changing a regex slightly. Goal in progress: make `parses nested brackets` pass.

**Diagnose.** Pattern: repeated same command with no forward progress. Classification: logic failure with a wrong hypothesis. The agent never read the failing assertion; it guessed at the regex.

**Recover.** Stop editing. Run the single failing test with verbose output and read the expected versus actual values. The assertion shows the parser is fine and the fixture has an unbalanced bracket.

**Report.**

```markdown
## Agent Self-Debug Report
- Session / task: fix parses-nested-brackets
- Failure: tool-call limit after 12 edit/test cycles
- Root cause: wrong hypothesis; fixture data was malformed, parser was correct
- Recovery action: ran the one failing test verbosely and read the diff
- Result: success
- Token / time burn risk: high; 12 cycles spent before observation
- Follow-up needed: none
- Preventive change to encode later: read the assertion before the first edit
```

### Example 2: Connection refused during an integration step

**Capture.** `ECONNREFUSED 127.0.0.1:5432` on the third retry of a migration command. Environment assumption not yet verified: that the database container is running.

**Diagnose.** Pattern: service unavailable or wrong port. Classification: environment failure, likely deterministic. The smallest discriminating check is a health probe, not another migration attempt.

**Recover.** Run the container status command. The database container exited on startup because its data volume is missing. Restart it with the volume mounted, confirm the port answers, then run the migration once.

**Report.** Result `success`, root cause `database container not running`, preventive change `add a health check before migration steps`. If the container could not be restarted from this environment, the result would be `blocked` with an escalation note instead of further retries.

## Integration with ECC

- Use `verification-loop` after recovery if code was changed.
- Use `continuous-learning-v2` when the failure pattern is worth turning into an instinct or later skill.
- Use `council` when the issue is not technical failure but decision ambiguity.
- Use `workspace-surface-audit` if the failure came from conflicting local state or repo drift.

## Output Standard

When this skill is active, do not end with “I fixed it” alone.

Always provide:
- the failure pattern
- the root-cause hypothesis
- the recovery action
- the evidence that the situation is now better or still blocked
