# React Styleguide

Apply `general.md` plus `javascript.md` or `typescript.md` first.

## React defaults

- Write components and Hooks as pure functions: the same inputs produce the same render output.
- Treat props, state, context, and Hook arguments/return values as immutable snapshots.
- Call Hooks only at the top level of React components or custom Hooks; never conditionally or in ordinary functions.
- Use Effects only to synchronize with external systems. Derive render data during render instead of mirroring it into state.
- Keep state as local as practical and maintain one source of truth; lift it only to the closest common owner.
- Prefer composition and focused components over inheritance or large configurable components.
- Give list items stable domain keys, not array indexes when order/identity can change.
- Keep event-driven work in event handlers and render-driven synchronization in Effects; include complete dependencies.
- Make loading, empty, error, and success states explicit.
- Use semantic HTML, accessible names, keyboard behavior, and focus management.

## Verification

- Enable the official React Hooks lint rules and the repository's formatter/linter.
- Test behavior through user-visible interactions; cover state transitions, errors, accessibility, and cleanup.
- Profile before adding memoization; treat `useMemo`/`useCallback` as optimizations, not correctness tools.

## Sources

- [Rules of React](https://react.dev/reference/rules)
- [Keeping Components Pure](https://react.dev/learn/keeping-components-pure)
- [React documentation](https://react.dev/learn)
