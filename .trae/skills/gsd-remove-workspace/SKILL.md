---
name: gsd-remove-workspace
description: Remove a GSD workspace and clean up worktrees
---

<context>
**Arguments:**
- `<workspace-name>` (required) — Name of the workspace to remove
</context>

<objective>
Remove a workspace directory after confirmation. For worktree strategy, runs `git worktree remove` for each member repo first. Refuses if any repo has uncommitted changes.
</objective>

<execution_context>
@E:/watsaap broadcast/.trae/get-shit-done/workflows/remove-workspace.md
@E:/watsaap broadcast/.trae/get-shit-done/references/ui-brand.md
</execution_context>

<process>
Execute the remove-workspace workflow from @E:/watsaap broadcast/.trae/get-shit-done/workflows/remove-workspace.md end-to-end.
</process>
