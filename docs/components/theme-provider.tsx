"use client"

import * as React from "react"

type Theme = "system" | "light" | "dark"
type ResolvedTheme = Exclude<Theme, "system">

type ThemeContextValue = {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

const THEME_STORAGE_KEY = "cadre-docs-theme"
const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)"
const ThemeContext = React.createContext<ThemeContextValue | null>(null)

const themeScript = `
(() => {
  const key = ${JSON.stringify(THEME_STORAGE_KEY)};
  let theme = "system";

  try {
    const storedTheme = sessionStorage.getItem(key);
    if (storedTheme === "light" || storedTheme === "dark" || storedTheme === "system") {
      theme = storedTheme;
    }
  } catch {}

  const resolvedTheme = theme === "system"
    ? (matchMedia(${JSON.stringify(SYSTEM_THEME_QUERY)}).matches ? "dark" : "light")
    : theme;
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolvedTheme);
  root.style.colorScheme = resolvedTheme;
})();
`

function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>("system")
  const [systemTheme, setSystemTheme] = React.useState<ResolvedTheme>("light")
  const [ready, setReady] = React.useState(false)
  const resolvedTheme = theme === "system" ? systemTheme : theme

  React.useEffect(() => {
    const mediaQuery = window.matchMedia(SYSTEM_THEME_QUERY)
    const storedTheme = readStoredTheme()
    const initialSystemTheme = getSystemTheme(mediaQuery)

    setThemeState(storedTheme)
    setSystemTheme(initialSystemTheme)
    applyTheme(storedTheme === "system" ? initialSystemTheme : storedTheme)
    setReady(true)

    function onSystemThemeChange(event: MediaQueryListEvent) {
      setSystemTheme(event.matches ? "dark" : "light")
    }

    mediaQuery.addEventListener("change", onSystemThemeChange)
    return () => mediaQuery.removeEventListener("change", onSystemThemeChange)
  }, [])

  React.useEffect(() => {
    if (ready) {
      applyTheme(resolvedTheme)
    }
  }, [ready, resolvedTheme])

  const setTheme = React.useCallback((nextTheme: Theme) => {
    setThemeState(nextTheme)

    try {
      window.sessionStorage.setItem(THEME_STORAGE_KEY, nextTheme)
    } catch {
      // Theme switching still works when storage is unavailable.
    }
  }, [])

  const value = React.useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [resolvedTheme, setTheme, theme]
  )

  return (
    <ThemeContext.Provider value={value}>
      <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      <ThemeHotkey />
      {children}
    </ThemeContext.Provider>
  )
}

function useTheme() {
  const context = React.useContext(ThemeContext)

  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider")
  }

  return context
}

function readStoredTheme(): Theme {
  try {
    const storedTheme = window.sessionStorage.getItem(THEME_STORAGE_KEY)
    if (storedTheme === "light" || storedTheme === "dark" || storedTheme === "system") {
      return storedTheme
    }
  } catch {
    // Fall through to the per-session default.
  }

  return "system"
}

function getSystemTheme(mediaQuery = window.matchMedia(SYSTEM_THEME_QUERY)): ResolvedTheme {
  return mediaQuery.matches ? "dark" : "light"
}

function applyTheme(theme: ResolvedTheme) {
  const root = document.documentElement
  root.classList.remove("light", "dark")
  root.classList.add(theme)
  root.style.colorScheme = theme
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

function ThemeHotkey() {
  const { resolvedTheme, setTheme } = useTheme()

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) {
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (event.key.toLowerCase() !== "d" || isTypingTarget(event.target)) {
        return
      }

      setTheme(resolvedTheme === "dark" ? "light" : "dark")
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [resolvedTheme, setTheme])

  return null
}

export { ThemeProvider, useTheme }
export type { Theme }
