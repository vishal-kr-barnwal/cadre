# TypeScript Styleguide

Apply `general.md` and `javascript.md` first. Preserve approved compiler/linter settings; enable strictness for greenfield code.

## Idiomatic defaults

- Enable `strict` and the strongest practical project checks; do not weaken global settings to bypass a local issue.
- Use primitive types (`string`, `number`, `boolean`) rather than boxed types.
- Prefer `unknown` over `any`; narrow values through validation, type guards, or schema parsing.
- Model alternatives with discriminated unions and make switches exhaustive with `never` checks where useful.
- Prefer inference for obvious local values and explicit types for public boundaries, serialized data, and complex returns.
- Keep type assertions rare and local; never use assertion chains to silence an unresolved mismatch.
- Avoid non-null assertions unless an invariant is proven and documented.
- Use generics only when the type parameter expresses a real relationship.
- Keep runtime validation distinct from compile-time typing at network, storage, environment, and user-input boundaries.
- Use `satisfies` when validating a value's shape while retaining useful inference.

## Verification

- Run the formatter, ESLint/type-aware lint rules, `tsc --noEmit`, tests, and the production build.
- Add compile-time tests for public generic/type utilities when their behavior is non-trivial.

## Sources

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [TypeScript Do's and Don'ts](https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html)
