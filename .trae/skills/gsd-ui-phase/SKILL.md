---
name: gsd-ui-phase
description: Generate UI design contract (UI-SPEC.md) for frontend phases
---

<objective>
Create a UI design contract (UI-SPEC.md) for a frontend phase.
Orchestrates gsd-ui-researcher and gsd-ui-checker.
Flow: Validate → Research UI → Verify UI-SPEC → Done
</objective>

<execution_context>
@E:/watsaap broadcast/.trae/get-shit-done/workflows/ui-phase.md
@E:/watsaap broadcast/.trae/get-shit-done/references/ui-brand.md
</execution_context>

<context>
Phase number: {{GSD_ARGS}} — optional, auto-detects next unplanned phase if omitted.
</context>

<process>
Execute @E:/watsaap broadcast/.trae/get-shit-done/workflows/ui-phase.md end-to-end.
Preserve all workflow gates.
</process>
