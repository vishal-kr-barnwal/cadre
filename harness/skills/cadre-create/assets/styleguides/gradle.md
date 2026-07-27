# Gradle Build Styleguide

Apply `general.md` and the applicable JVM/Android language guide first.

## Build defaults

- Use the Gradle Wrapper and run builds through `./gradlew`.
- Prefer Kotlin DSL for new builds; preserve an established Groovy DSL unless migration is explicitly approved.
- Declare plugins with the `plugins` block and name the root project in `settings.gradle(.kts)`.
- Keep production source out of the root project; split modules along cohesive product/build boundaries.
- Encapsulate shared build logic in convention plugins, preferably in an included `build-logic` build.
- Avoid broad `allprojects`/`subprojects`, `afterEvaluate`, internal APIs, and configuration-time I/O.
- Register/configure tasks lazily and declare inputs/outputs so caching and incremental execution remain correct.
- Centralize dependency coordinates/versions with version catalogs or approved dependency-management mechanisms.
- Keep repositories centralized and intentional; never embed credentials in build scripts.
- Preserve configuration-cache/build-cache compatibility where the project enables them.

## Verification

- Run the relevant `./gradlew check`/build tasks with the project warning policy.
- For build-logic changes, test representative modules plus configuration-cache behavior when enabled.
- Review dependency insight, verification/locking, and generated artifacts for dependency changes.

## Sources

- [Gradle general best practices](https://docs.gradle.org/current/userguide/best_practices_general.html)
- [Gradle build-structure best practices](https://docs.gradle.org/current/userguide/best_practices_structuring_builds.html)
- [Organizing Gradle projects](https://docs.gradle.org/current/userguide/organizing_gradle_projects.html)
