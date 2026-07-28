"use client"

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"

import { useTheme, type Theme } from "@/components/theme-provider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

const themeOptions = [
  { value: "system", label: "System theme", icon: MonitorIcon },
  { value: "light", label: "Light theme", icon: SunIcon },
  { value: "dark", label: "Dark theme", icon: MoonIcon },
] satisfies ReadonlyArray<{
  value: Theme
  label: string
  icon: typeof MonitorIcon
}>

function ThemeSwitcher() {
  const { mounted, theme, setTheme } = useTheme()

  function onValueChange(values: string[]) {
    const nextTheme = values[0]
    if (
      nextTheme === "system" ||
      nextTheme === "light" ||
      nextTheme === "dark"
    ) {
      setTheme(nextTheme)
    }
  }

  return (
    <ToggleGroup
      aria-label="Theme preference"
      className="bg-background/80"
      value={[mounted ? theme : "system"]}
      onValueChange={onValueChange}
      variant="outline"
      size="sm"
      spacing={0}
    >
      {themeOptions.map(({ value, label, icon: Icon }) => (
        <ToggleGroupItem
          key={value}
          value={value}
          aria-label={label}
          title={label}
        >
          <Icon aria-hidden="true" />
          <span className="sr-only">{label}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

export { ThemeSwitcher }
