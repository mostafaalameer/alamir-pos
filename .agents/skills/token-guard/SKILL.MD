---
name: token-guard
description: Enforces strict token-budget conservation, preventing verbose reasoning loops, large context dumps, and unconstrained background tool invocations in Antigravity (especially for Gemini 4 Argon).
---

# Token Guard & Anti-Waste Execution Policy

## 1. Context & Reading Limits
- **Targeted Inspections Only**: NEVER dump entire large directories or read multiple full files simultaneously.
- **Specific Line Ranges**: Always inspect only relevant code chunks using line-range reads or symbol searches rather than reading complete files.
- **No Redundant Reads**: Do not re-read files that have already been loaded or unchanged in the current session.

## 2. Response & Output Conciseness
- **Zero Fluff**: Do not write long conversational introductions, repeated summaries, or boilerplate preambles.
- **Targeted Diffs**: Show only minimal code diffs or edited functions rather than re-printing the whole source file.
- **Single-Turn Decisions**: Avoid unnecessary multi-turn thinking loops or self-reinforcing background retries. If a command fails twice, stop immediately, report the failure, and request human input.

## 3. Strict Tool & Command Rules
- **No Heavy Builds/Dumps**: Avoid running commands that output thousands of lines to terminal stdout (e.g., pipe to `head -n 20` or silence noisy build logs).
- **Proactive Stopping**: Complete only the exact requested task. Do NOT proactively refactor unrelated files, optimize dependencies, or generate unrequested boilerplate.
- **Compact Checkpoints**: After completing a task, summarize changes in 3 bullet points maximum so context compaction remains minimal.