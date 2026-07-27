# Python Styleguide

Apply `general.md` first. Follow repository formatter/linter/type-checker configuration; otherwise use PEP 8 as the baseline.

## Pythonic defaults

- Use four spaces, UTF-8, and automatic formatting. Keep imports at the top in standard-library, third-party, and local groups.
- Use `snake_case` for functions/variables/modules, `CapWords` for classes, and `UPPER_SNAKE_CASE` for constants.
- Prefer clear, direct Python constructs: comprehensions only when readable, context managers for resources, and iteration over manual indexing.
- Compare singleton sentinels such as `None` with `is`/`is not`.
- Use type annotations on public boundaries and non-obvious values; keep runtime validation at untrusted boundaries.
- Raise specific exceptions, preserve causes with `raise ... from ...`, and never use bare `except` for routine handling.
- Use immutable values/defaults where practical; never use a mutable object as a function default.
- Keep modules cohesive and public interfaces explicit. Use dataclasses/value objects where they clarify data semantics.
- Write docstrings for public modules, classes, functions, and methods; keep comments synchronized with behavior.
- Avoid hidden import-time side effects and global mutable state.

## Verification

- Run the approved formatter, linter, type checker, and test suite.
- Test exceptions, boundary values, resource cleanup, async cancellation, and supported Python versions as applicable.

## Sources

- [PEP 8 – Style Guide for Python Code](https://peps.python.org/pep-0008/)
- [PEP 257 – Docstring Conventions](https://peps.python.org/pep-0257/)
- [Python documentation](https://docs.python.org/3/)
