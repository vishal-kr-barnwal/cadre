# Android (Kotlin) Style Guide Summary

This document summarizes key rules and best practices from the Android Kotlin Style Guide and Architecture Guidelines for building idiomatic, maintainable Android applications.

## 1. Formatting and Tooling
- **ktlint:** Enforce via Gradle plugin. All code must pass `./gradlew ktlintCheck` before review.
- **detekt:** Use for static analysis beyond formatting. Fail CI on new issues.
- **Android Lint:** Run `./gradlew lint` and resolve all errors and relevant warnings before release builds.
- Follow all base [Kotlin Coding Conventions](kotlin.md) for formatting, naming, and language features.

## 2. Architecture (MVVM + Clean)
- **MVVM:** Use ViewModel + LiveData/StateFlow + View/Fragment as the standard architecture. ViewModels must not hold references to `Context`, `View`, or `Fragment`.
- **Single-activity:** Prefer a single-activity app with multiple Fragments or Jetpack Compose destinations over multiple Activities.
- **Repository pattern:** Abstract data sources behind a `Repository` interface. ViewModels call repositories; repositories call data sources (API, Room, DataStore).
- **Use cases / Interactors:** Extract business logic into `UseCase` classes (one responsibility each) for complex or reused logic. Keep ViewModels thin.
- **Unidirectional data flow (UDF):** State flows down (ViewModel → View); events flow up (View → ViewModel). Use `StateFlow`/`SharedFlow` or sealed `UiState` classes.

## 3. ViewModels
- **`viewModelScope`:** Always use `viewModelScope` to launch coroutines from a ViewModel. Coroutines are cancelled automatically when the ViewModel is cleared.
- **Expose `StateFlow`/`LiveData`, not `MutableStateFlow`/`MutableLiveData`:** Use backing properties: `private val _state = MutableStateFlow(...)` exposed as `val state: StateFlow<...> = _state.asStateFlow()`.
- **`UiState` sealed class:** Model screen state with a sealed class: `sealed class UiState { object Loading; data class Success(val data: T); data class Error(val message: String) }`.
- **No Android framework imports:** ViewModels must not import `android.*` classes (except `Application` in `AndroidViewModel`). This ensures testability.
- **`SavedStateHandle`:** Use `SavedStateHandle` in ViewModels to survive process death, not `onSaveInstanceState` in Fragments.

## 4. Fragments and Activities
- **Fragment arguments via `newInstance`:** Always pass arguments via `Bundle` in a static `newInstance()` factory method. Never set properties directly on a Fragment after construction.
- **View binding:** Use View Binding (`viewBinding = true`) over `findViewById`. Never use synthetic imports (Kotlin Android Extensions is deprecated).
- **Lifecycle awareness:** Collect `Flow` in `lifecycleScope.launch { repeatOnLifecycle(STARTED) { ... } }`. Do not collect in `onCreate` without `repeatOnLifecycle`.
- **`onViewCreated`:** Set up views and observers in `onViewCreated`, not `onCreateView`. Release view references in `onDestroyView` (especially with View Binding: set binding to `null`).
- **Avoid back-stack manipulation:** Let the NavController manage the back stack. Do not call `fragmentManager.popBackStack()` manually.

## 5. Jetpack Navigation
- **Single NavGraph per activity:** Define all destinations and actions in `nav_graph.xml`. Use nested graphs for feature modules.
- **Safe Args:** Use the Safe Args Gradle plugin for type-safe navigation arguments. Do not use raw `Bundle` keys for navigation data.
- **Deep links:** Declare deep link URIs in the NavGraph, not in `AndroidManifest.xml` `intent-filter` manually.

## 6. Room (Database)
- **`@Entity`:** Every table is a `data class` annotated with `@Entity`. Name tables explicitly with `tableName`.
- **`@Dao` interfaces:** Use `suspend` functions in DAOs for insert/update/delete. Return `Flow<T>` for queries to observe changes reactively.
- **No business logic in DAOs:** DAOs perform only data access. Transformations and filtering go in the repository or use case.
- **Database migrations:** Always write an explicit `Migration` for schema changes. Never use `fallbackToDestructiveMigration()` in production.
- **`@TypeConverter`:** Register converters for non-primitive types (e.g., `Date`, enums, custom objects).

## 7. Networking (Retrofit + OkHttp)
- **Suspend functions in API interfaces:** Use `suspend fun` in Retrofit service interfaces — no `Call<T>`, no RxJava.
- **Sealed result types:** Wrap API responses in a `Result<T>` or `NetworkResult<T>` sealed class in the repository. Never expose raw Retrofit exceptions to ViewModels.
- **OkHttp interceptors:** Use interceptors for auth headers, logging (`HttpLoggingInterceptor`), and retry logic. Do not add auth logic inside API service interfaces.
- **Timeouts:** Always configure connect, read, and write timeouts on `OkHttpClient`. Never use the default (unlimited) timeouts.

## 8. Dependency Injection (Hilt)
- **Hilt over manual DI:** Use Hilt (built on Dagger) as the standard DI framework. Avoid `ServiceLocator` patterns.
- **`@HiltViewModel`:** Annotate all ViewModels. Inject via `by viewModels()` in Fragments/Activities.
- **`@Singleton` scope:** Scope repositories and network clients to `@Singleton`. Scope ViewModels to `@HiltViewModel` (automatic).
- **Modules for external dependencies:** Create `@Module` + `@InstallIn` classes to provide third-party types (Retrofit, Room, etc.) that cannot be annotated directly.

## 9. Permissions
- **Request at the latest possible moment:** Ask for permissions immediately before the feature that needs them, not at app launch.
- **`ActivityResultContracts`:** Use `registerForActivityResult(RequestPermission())` — not `onRequestPermissionsResult`.
- **Handle denial gracefully:** Always handle both granted and denied cases. Show rationale with `shouldShowRequestPermissionRationale` before re-requesting.

## 10. Testing
- **ViewModel tests:** Test ViewModels with JUnit 4/5 and `kotlinx-coroutines-test`. Use `TestCoroutineDispatcher`/`UnconfinedTestDispatcher` and `Turbine` for `Flow` assertions.
- **Robolectric for unit tests:** Use Robolectric for tests needing Android framework context without an emulator.
- **Espresso / Compose UI tests:** Write UI tests for critical user journeys. Use `IdlingResource` for async operations in Espresso.
- **Fake over mock:** Prefer fake implementations of repositories/data sources over Mockito mocks for ViewModel tests. Fakes are more maintainable and realistic.

## 11. Resources
- **Naming conventions:**
  - Layouts: `fragment_user_profile.xml`, `item_order_card.xml`, `view_loading_spinner.xml`
  - IDs: `@+id/tvUserName` (type prefix) or `@+id/userNameText` (descriptive) — pick one and be consistent.
  - Strings: `user_profile_title`, `error_network_unavailable` — use `feature_description` format.
  - Drawables: `ic_` for icons, `bg_` for backgrounds, `img_` for images.
- **`strings.xml`:** All user-visible strings go in `strings.xml`. No hardcoded strings in layouts or code.
- **Dimensions:** Define reusable spacing in `dimens.xml`. Use `8dp` grid system.

*Sources: [Android Kotlin Style Guide](https://developer.android.com/kotlin/style-guide) · [Guide to app architecture](https://developer.android.com/topic/architecture) · [Hilt docs](https://developer.android.com/training/dependency-injection/hilt-android)*
