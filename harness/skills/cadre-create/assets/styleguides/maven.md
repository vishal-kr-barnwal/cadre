# Maven Build Styleguide

Apply `general.md` and the applicable JVM language guide first.

## Build defaults

- Follow Maven's standard directory layout; override it only for an evidenced project constraint.
- Use the Maven Wrapper when the project adopts it and run builds through `./mvnw`.
- Keep `pom.xml` declarative and readable. Prefer lifecycle/plugin configuration over shell-driven build steps.
- Pin plugin versions and define shared versions once in properties, `dependencyManagement`, or an imported BOM.
- Declare direct dependencies explicitly with the narrowest correct scope. Do not rely accidentally on transitive dependencies.
- Keep parent POM and multi-module relationships shallow and purposeful; modules follow the same standard layout.
- Put reusable build policy in parent/plugin management rather than duplicating it across modules.
- Avoid system-scoped dependencies, version ranges, hidden local-repository assumptions, and secrets in POMs/settings committed to Git.
- Configure reproducible outputs when publishing artifacts, including `project.build.outputTimestamp` and compatible plugin versions.
- Use profiles only for real environment/build variants; keep the default build deterministic.

## Verification

- Run `./mvnw verify` (or the approved Maven command) from a clean checkout.
- Inspect dependency convergence/tree and plugin validation for dependency/build changes.
- Ensure generated output stays under `target/` and is not committed unless explicitly required.

## Sources

- [Maven standard directory layout](https://maven.apache.org/guides/introduction/introduction-to-the-standard-directory-layout.html)
- [Maven dependency mechanism](https://maven.apache.org/guides/introduction/introduction-to-dependency-mechanism.html)
- [Maven reproducible builds](https://maven.apache.org/guides/mini/guide-reproducible-builds.html)
