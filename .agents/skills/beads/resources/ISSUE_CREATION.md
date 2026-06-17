# Issue Creation Guidelines

Guidance on when and how to create bd issues for maximum effectiveness.

## Contents

- [When to Ask First vs Create Directly](#when-to-ask)
- [Issue Quality](#quality)
- [Making Issues Resumable](#resumable)
- [Design vs Acceptance Criteria](#design-vs-acceptance)
- [New Issue Types (v1.0.0+)](#issue-types)

## When to Ask First vs Create Directly {#when-to-ask}

### Ask the user before creating when:
- Knowledge work with fuzzy boundaries
- Task scope is unclear
- Multiple valid approaches exist

### Create directly when:
- Clear bug discovered during implementation
- Obvious follow-up work identified
- Technical debt with clear scope
- Dependency or blocker found

## Issue Quality {#quality}

Use clear, specific titles and include sufficient context in descriptions.

### Field Usage

**Use --design flag for:**
- Implementation approach decisions
- Architecture notes
- Trade-offs considered

**Use --acceptance flag for:**
- Definition of done
- Testing requirements

## Making Issues Resumable {#resumable}

For complex features spanning multiple sessions, use `bd note` to checkpoint progress.

```bash
bd note issue-9 "IMPLEMENTATION GUIDE:
WORKING CODE: service.about().get(fields='importFormats')
CONTEXT: text/markdown support added July 2024" --json
```

## Design vs Acceptance Criteria {#design-vs-acceptance}

- **DESIGN field**: HOW to build it (can change during work).
- **ACCEPTANCE CRITERIA**: WHAT success looks like (stable outcome).

## New Issue Types (v1.0.0+) {#issue-types}

- **Story**: Standard user-facing work item.
- **Spike**: Exploratory research or prototyping.
- **Milestone**: Project phase or release target.
- **Epic**: High-level feature container.

**Example hierarchy:**
Epic (bd-1) -> Milestone (bd-1.1) -> Story (bd-1.1.1)
