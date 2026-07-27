# Default Styleguide Catalog

Use this catalog during `cadre-create`. Always propose the project template's `styleguides/general.md`, then select defaults from the approved technology stack. Present every selected guide for human approval; copy a default only when the human accepts it. The human may amend a default or provide a complete replacement.

| Tech-stack evidence | Default guides to propose |
| --- | --- |
| Go | `go.md` |
| Java | `java.md`, plus `maven.md` or `gradle.md` when used |
| Kotlin | `kotlin.md`, plus `gradle.md` or `maven.md` when used |
| Maven | `maven.md` |
| Gradle | `gradle.md` |
| JavaScript | `javascript.md` |
| TypeScript | `javascript.md` and `typescript.md` |
| React with JavaScript | `javascript.md` and `react.md` |
| React with TypeScript | `javascript.md`, `typescript.md`, and `react.md` |
| Dart | `dart.md` |
| Flutter | `dart.md` and `flutter.md` |
| Swift | `swift.md` |
| SwiftUI | `swift.md` and `swiftui.md` |
| Python | `python.md` |

If the stack is not represented, derive a project guide from `styleguides/language.md`, official ecosystem guidance, repository evidence, and user input. Do not invent conventions when a material choice is unclear.

For brownfield projects, inspect formatter/linter/build configuration and representative source before proposing defaults. Existing automated conventions win unless the human explicitly approves a change.
