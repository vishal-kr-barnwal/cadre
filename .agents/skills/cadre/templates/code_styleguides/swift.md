# Swift API Design Guidelines Style Guide Summary

This document summarizes key rules and best practices from the Swift API Design Guidelines and Swift.org style conventions for writing idiomatic, safe, and expressive Swift code.

## 1. Formatting
- **SwiftFormat / SwiftLint:** Format with `swiftformat` and lint with `swiftlint`. Enforce both in CI. Include `.swiftlint.yml` in the repository root.
- **Indentation:** 4 spaces. No tabs.
- **Line Length:** 120 characters maximum (SwiftLint default; adjust to team preference).
- **Blank lines:** One blank line between declarations. Two blank lines between major sections (e.g., before `// MARK:` sections).

## 2. Naming
- **`UpperCamelCase`:** For types (class, struct, enum, protocol, typealias) and enum cases.
- **`lowerCamelCase`:** For functions, methods, properties, parameters, and local variables.
- **Clarity at the call site:** Name things so usage reads like prose: `list.insert(element, at: index)`, not `list.insert(element, position: index)`.
- **Omit needless words:** Do not repeat the type in the name. `backgroundColor`, not `backgroundColorOfView`. `users.remove(at: index)`, not `users.removeElement(at: index)`.
- **Boolean properties:** Start with `is`, `has`, `can`, or `should`: `isEnabled`, `hasChildren`, `canClose`.
- **Protocol naming:**
  - Protocols describing what something *is*: noun (`Collection`, `Sequence`).
  - Protocols describing a *capability*: `-able`, `-ible`, `-ing` suffix (`Hashable`, `Codable`, `Equatable`).
- **Avoid abbreviations:** Use full words. `destinationURL` not `destURL`, `error` not `err`, `index` not `idx`. Well-known abbreviations (`URL`, `ID`, `JSON`) are fine.
- **First argument label:** Omit when it is obviously part of the function name: `x.addSubview(y)` not `x.addSubview(view: y)`. Include when it adds clarity: `a.move(from: b, to: c)`.

## 3. Types
- **`struct` by default:** Prefer value types (`struct`, `enum`) over reference types (`class`). Use `class` only when identity semantics, inheritance, or reference sharing is required.
- **`final` by default:** Mark classes `final` unless designed for subclassing. Subclassable classes are a design decision, not a default.
- **`enum` for closed sets:** Use `enum` for a fixed set of related values. Use `CaseIterable` when you need to enumerate cases.
- **Associated values:** Use `enum` with associated values as discriminated unions: `enum Result<T> { case success(T); case failure(Error) }`.
- **`typealias`:** Use to clarify the role of complex types: `typealias Completion = (Result<User, Error>) -> Void`.
- **`extension` over subclass:** Prefer extending a type to add behavior over subclassing. Extensions cannot store state — use composition for that.

## 4. Optionals
- **Avoid `!` force-unwrap:** Force-unwrap is a crash waiting to happen. Use `guard let`, `if let`, or `??` instead.
- **`guard let` for early exit:** Use `guard let` to unwrap optionals at the top of a function when `nil` means "cannot proceed". This reduces nesting.
- **`if let` for optional use:** Use `if let` when the `nil` case is a legitimate alternate path.
- **Optional chaining (`?.`):** Use for accessing properties/methods on optionals where `nil` propagation is correct.
- **`??` for defaults:** Use the nil-coalescing operator for fallback values: `let name = user?.name ?? "Unknown"`.
- **Implicit optionals (`!` type):** Use `@IBOutlet weak var button: UIButton!` and similarly initialized-before-use patterns — keep to `@IBOutlet` and injection patterns only. Never use `!` types for general logic.

## 5. Functions and Closures
- **Single responsibility:** Each function does one thing. Break down large functions.
- **`@discardableResult`:** Add only when ignoring the result is a common and correct pattern. Do not add it to silence warnings mechanically.
- **Trailing closure syntax:** Use trailing closure syntax when the closure is the last parameter and its role is clear: `UIView.animate(withDuration: 0.3) { ... }`.
- **`@escaping`:** Mark closures `@escaping` when they outlive the function call. Document the lifecycle implications.
- **`inout`:** Use `inout` sparingly. Prefer returning a new value over mutating in place unless performance is critical.
- **`throws` / `async throws`:** Use `throws` for functions that can fail with typed errors. Use `async` for asynchronous work. Combine as `async throws` for async-fallible functions.

## 6. Error Handling
- **`throws` + `try`:** Use Swift's typed error handling for recoverable errors. Functions that can fail return via `throw`, not via optional or sentinel values.
- **`do / catch`:** Handle errors at the appropriate layer. Do not `try!` unless a failure is genuinely impossible and you can prove it.
- **`Result<T, Error>`:** Use `Result` for asynchronous completions that predate `async/await`, or when you need to store a result for later.
- **Custom error types:** Define `enum MyError: Error, LocalizedError` with associated values for structured error information. Implement `errorDescription` for user-facing messages.
- **`try?`:** Use when `nil` on failure is acceptable and the error is irrelevant to the caller.

## 7. Concurrency (Swift Concurrency)
- **`async`/`await`:** Prefer Swift Concurrency over completion handlers, Combine, or DispatchQueue-based async code for new code.
- **`Task { }`:** Use to bridge from synchronous to async context. Use `Task.detached` only when the task must not inherit actor context.
- **`@MainActor`:** Annotate types or functions that must run on the main thread. Use `@MainActor` on ViewModels/Controllers rather than `DispatchQueue.main.async`.
- **`actor`:** Use `actor` types for shared mutable state. Actors serialize access and eliminate data races.
- **`Sendable`:** Mark types crossing actor boundaries as `Sendable`. Do not suppress `Sendable` warnings with `@unchecked Sendable` without justification.
- **`async let`:** Use `async let` for independent concurrent work within a function: `async let user = fetchUser(); async let feed = fetchFeed(); let (u, f) = try await (user, feed)`.

## 8. Memory Management
- **ARC is automatic:** Do not call `retain`/`release`. ARC handles memory.
- **`weak` for delegates and callbacks:** Mark delegate properties `weak var` to avoid retain cycles. Capture `[weak self]` in closures that outlive the object.
- **`unowned` only when guaranteed:** Use `unowned` instead of `weak` only when the referenced object is guaranteed to outlive the closure/property. Incorrect `unowned` crashes; incorrect `weak` just produces `nil`.
- **`[weak self]` + guard:** Pattern: `{ [weak self] in guard let self = self else { return } ... }` (or `[weak self] in self?.doWork()`).

## 9. Collections and Functional Patterns
- **`map`, `filter`, `compactMap`, `reduce`:** Use functional transforms over `for` loops for collection transformations.
- **`compactMap`:** Use to filter `nil` from a sequence of optionals: `names.compactMap { user(id: $0)?.name }`.
- **`flatMap` on sequences:** Use to flatten sequences: `[[1,2],[3,4]].flatMap { $0 }` → `[1,2,3,4]`.
- **`lazy`:** Use `collection.lazy.filter { }.map { }` to avoid allocating intermediate arrays for long pipelines.

## 10. Documentation
- **`///` doc comments:** Use triple-slash comments for all public API. Xcode renders these in Quick Help.
- **Summary + discussion:** First line is the summary. Add a blank line then the discussion for longer explanations.
- **`- Parameter`, `- Returns`, `- Throws`:** Document parameters, return values, and thrown errors using these list items.
- **`- Note:`, `- Important:`, `- Warning:`:** Use callout keywords for additional reader guidance.
- **Code examples:** Include brief usage examples in doc comments for complex APIs using fenced code blocks.

*Sources: [Swift API Design Guidelines](https://swift.org/documentation/api-design-guidelines/) · [Swift.org Style Guide](https://google.github.io/swift/) · [Swift Concurrency](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/concurrency/)*
