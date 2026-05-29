# Effective Rust Style Guide Summary

This document summarizes key rules and best practices from the official Rust API Guidelines, Rust Style Guide, and idiomatic Rust conventions for writing safe, performant, and maintainable Rust code.

## 1. Formatting
- **`rustfmt`:** All Rust code **must** be formatted with `rustfmt`. This is non-negotiable. Run via `cargo fmt`.
- **`clippy`:** Run `cargo clippy` and fix all warnings before review. Treat lints as errors in CI: `RUSTFLAGS="-D warnings"`.
- **Indentation:** 4 spaces. No tabs.
- **Line Length:** 100 characters maximum (rustfmt default).

## 2. Naming
- **`snake_case`:** For functions, methods, variables, modules, and crates.
- **`UpperCamelCase`:** For types, traits, enums, and struct names.
- **`SCREAMING_SNAKE_CASE`:** For constants and statics.
- **`snake_case`:** For crate names (hyphens in `Cargo.toml` map to underscores in code).
- **Acronyms:** Treat acronyms as words — `HttpClient`, not `HTTPClient`; `JsonParser`, not `JSONParser`.
- **Getters:** Do not prefix with `get_`. A getter for `name` is `name()`, not `get_name()`.
- **Setters:** Use `set_name()`.
- **Builders:** Use the `Builder` suffix and return `Self` or `Result<T>` from `build()`.
- **Iterator adaptors:** Name the struct for its iterator, e.g., `Lines` for a `lines()` method.

## 3. Ownership and Borrowing
- **Prefer borrowing over cloning:** Pass `&T` or `&mut T` unless ownership transfer is required.
- **Prefer `&str` over `&String`:** Accept `&str` in function arguments; callers with `String` can deref. Same for `&[T]` over `&Vec<T>` and `&Path` over `&PathBuf`.
- **Minimize `clone()`:** A `clone()` call is a code smell if it can be avoided with a borrow.
- **Avoid `unwrap()` in library code:** Use `?` to propagate errors. Reserve `unwrap()` for prototypes, tests, or genuinely infallible paths (document why).
- **Use `expect()` over `unwrap()`** when a panic is intended: `expect("config file must exist")` produces better diagnostics.

## 4. Error Handling
- **`Result<T, E>` is the standard:** Use it for all fallible functions. Never silently discard errors.
- **`?` operator:** Use `?` to propagate errors up the call stack. Do not write `match` blocks for simple propagation.
- **Error types:** In libraries, define a custom error type implementing `std::error::Error`. Use `thiserror` crate. In applications, use `anyhow` for ergonomic error context.
- **`panic!`:** Reserved for unrecoverable programming errors (invariant violations). Libraries must not panic in normal operation.
- **`unwrap_or_else`, `map`, `and_then`:** Chain `Result`/`Option` combinators for concise, readable error paths.

## 5. Types and Traits
- **Newtype pattern:** Wrap primitive types in newtypes to enforce invariants: `struct Meters(f64);`.
- **Derive common traits:** Derive `Debug`, `Clone`, `PartialEq`, `Eq`, `Hash`, `Default` where appropriate. Always derive `Debug`.
- **`Default` trait:** Implement `Default` for types that have a sensible zero/empty value. Use `#[derive(Default)]` when possible.
- **Trait objects vs. generics:** Prefer generics (`fn foo<T: Trait>(x: T)`) for performance. Use `dyn Trait` only when type erasure is needed (heterogeneous collections, dynamic dispatch).
- **`impl Trait` in return position:** Use for simple cases to hide concrete return types without boxing.
- **Sealed traits:** Use the sealed-trait pattern to prevent external implementations of traits not designed for extension.
- **Iterator:** Implement `Iterator` for custom collections. Return `impl Iterator` from methods rather than concrete types.

## 6. Enums and Pattern Matching
- **Enums over booleans:** Prefer `enum Direction { Left, Right }` over `bool` for clarity.
- **`match` is exhaustive:** Always handle all variants. Prefer explicit arms over `_ =>` wildcards when variants may be added.
- **`if let` / `while let`:** Use for single-pattern matching instead of a full `match` block.
- **`Option` instead of null:** Never model absence with sentinel values. Use `Option<T>`.
- **Avoid nested `match`:** Flatten with combinators (`map`, `and_then`, `unwrap_or`) or `?`.

## 7. Concurrency
- **Fearless concurrency:** Let the compiler enforce thread safety via `Send` and `Sync` bounds.
- **Prefer channels over shared state:** Use `std::sync::mpsc` or `tokio::sync` channels.
- **`Arc<Mutex<T>>`:** Standard pattern for shared mutable state. Lock for the minimum scope needed.
- **`async`/`await`:** Use for I/O-bound concurrency. Use `tokio` or `async-std` as the runtime. Do not block inside async functions — use `tokio::task::spawn_blocking` for CPU-bound work.
- **`rayon`:** Use for data-parallel CPU-bound work instead of manual threading.

## 8. Modules and Visibility
- **`pub` is an API contract:** Only `pub` what is intended to be part of the public API. Default to private.
- **`pub(crate)`:** Use for items shared within a crate but not externally.
- **`mod.rs` vs. inline modules:** Prefer `module/mod.rs` for multi-file modules. Prefer inline `mod` for small, single-file submodules.
- **`use` declarations:** Group imports: std → external crates → local. Use `rustfmt` to sort.
- **Re-exports:** Re-export public types at the crate root to flatten the API surface.

## 9. Performance
- **Zero-cost abstractions:** Trust iterators, closures, and generics — they compile to the same code as manual loops.
- **Avoid unnecessary allocation:** Prefer stack types and slices. Profile before switching to `Box`, `Vec`, or `Arc`.
- **`Cow<str>` / `Cow<[T]>`:** Use when a function sometimes needs to allocate and sometimes doesn't.
- **Inline:** Use `#[inline]` on small hot functions. Use `#[inline(always)]` sparingly.

## 10. Documentation
- **`///` doc comments:** All public items **must** have doc comments. Include an example in `# Examples` for non-trivial functions.
- **`//!` module docs:** Add module-level documentation explaining purpose and usage.
- **`# Panics` / `# Errors` / `# Safety`:** Document these sections on any function that panics, returns `Result`, or is `unsafe`.
- **`cargo doc --open`:** Verify documentation renders correctly before publishing.
- **`unsafe` blocks:** Every `unsafe` block **must** have a `// SAFETY:` comment explaining why the invariants are upheld.

*Sources: [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/) · [Rust Style Guide](https://doc.rust-lang.org/nightly/style-guide/) · [The Rust Book](https://doc.rust-lang.org/book/)*
