---
name: supermarket-architect
description: Enforces strict step-by-step TDD, schema integrity, and zero-shortcut development for the supermarket POS system.
---

# Supermarket System Strict Builder Skill

## 1. Operating Boundaries
- **No Hallucinated Code**: Never implement placeholder code (e.g., `// TODO: add logic later`) for critical business functions.
- **Strict Isolation**: Execute one milestone at a time. Stop and request explicit user confirmation before advancing to the next milestone.
- **Database Safety**: All sales, returns, and inventory updates MUST be wrapped in explicit transactions (`prisma.$transaction`).

## 2. Mandatory Verification Step
Before marking any task as complete:
1. Verify that TypeScript compiles with zero errors (`tsc --noEmit`).
2. Run automated unit/integration tests covering the created endpoints.
3. Provide a clear summary of modified/created files and manual cURL/API verification commands.

## 3. Architecture Rules
- Use clean layered architecture: `Routes` -> `Controllers` -> `Services` -> `Database Client`.
- Keep the POS checkout path completely functional offline via SQLite.
- Maintain FIFO batch deduction strictly on every item sold.