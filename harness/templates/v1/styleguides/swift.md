# Swift Styleguide

Apply `general.md` first. Preserve the repository's approved formatter and compiler-warning policy.

## Idiomatic defaults

- Optimize names and APIs for clarity at the call site; clarity is more important than brevity.
- Use `UpperCamelCase` for types/protocols and `lowerCamelCase` for other declarations.
- Prefer `let` and value types for data with value semantics; use reference types when identity/lifecycle is intentional.
- Model domain states with enums and associated values; make switches exhaustive.
- Use optionals to represent absence, unwrap with `if let`/`guard let`, and avoid force unwraps except proven invariants.
- Prefer typed throws/results and actionable error context; do not discard errors with `try?` unless absence is the intended contract.
- Keep access control as narrow as possible and document public APIs with Swift Markdown/DocC comments.
- Use protocol abstractions for real substitutability/test seams, not automatically for every concrete type.
- Use structured concurrency (`async`/`await`, task groups, actors) and make actor isolation, cancellation, and `Sendable` boundaries explicit.
- Avoid shared mutable global state and detached tasks without clear ownership.

## Verification

- Run the approved formatter/linter, build with warnings policy, and Swift Testing/XCTest suites.
- Test error paths, optionals, concurrency cancellation/isolation, public APIs, and supported Apple/Linux targets as applicable.

## Sources

- [Swift API Design Guidelines](https://www.swift.org/documentation/api-design-guidelines/)
- [The Swift Programming Language](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/)
- [Swift documentation](https://www.swift.org/documentation/)
