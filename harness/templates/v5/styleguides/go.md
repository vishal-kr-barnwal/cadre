# Go Styleguide

Apply `general.md` first. Repository formatter/linter configuration takes precedence when explicitly approved.

## Idiomatic defaults

- Format all source with `gofmt`; use `goimports` when the project adopts it.
- Use short, lowercase, single-word package names. Avoid catch-all packages such as `util`, `common`, or `misc`.
- Keep exported names purposeful; avoid repeating the package name in identifiers.
- Write doc comments for exported packages, types, functions, methods, and variables. Begin declaration comments with the declared name when natural.
- Accept interfaces at the consumer boundary and return concrete types unless abstraction is required.
- Keep interfaces small and define them near their consumers.
- Handle every error deliberately. Add useful context without obscuring the original error; use `errors.Is`/`errors.As` for semantic checks.
- Reserve `panic` for unrecoverable programmer/invariant failures, not routine error handling.
- Pass `context.Context` explicitly as the first parameter for request-scoped cancellation/deadlines; do not store it in structs.
- Make goroutine ownership, cancellation, and shutdown explicit. Avoid goroutine/channel leaks.
- Prefer simple control flow, early returns, and zero-value-useful types.

## Verification

- Run `gofmt`/`goimports`, `go vet ./...`, and `go test ./...`.
- Prefer table-driven tests for repeated behavior and include failure/edge cases.
- Run the race detector for concurrency-sensitive changes when practical.

## Sources

- [Effective Go](https://go.dev/doc/effective_go)
- [Go Code Review Comments](https://go.dev/wiki/CodeReviewComments)
- [Go Doc Comments](https://go.dev/doc/comment)
