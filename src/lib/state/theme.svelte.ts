export type ThemeMode = 'dark' | 'light'

const THEME_STORAGE_KEY = 'syrup-theme'
const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)'

class ThemeController {
  theme: ThemeMode = $state('dark')
  private systemThemeMedia: MediaQueryList | null = null

  mount = () => {
    const storedTheme = typeof localStorage !== 'undefined' ? localStorage.getItem(THEME_STORAGE_KEY) : null
    this.setTheme(storedTheme === 'dark' || storedTheme === 'light' ? storedTheme : this.getSystemTheme())

    if (typeof window === 'undefined') return
    this.systemThemeMedia = window.matchMedia(SYSTEM_THEME_QUERY)
    this.systemThemeMedia.addEventListener('change', this.handleSystemThemeChange)
  }

  destroy = () => {
    this.systemThemeMedia?.removeEventListener('change', this.handleSystemThemeChange)
    this.systemThemeMedia = null
  }

  toggleTheme = () => {
    this.setTheme(this.theme === 'dark' ? 'light' : 'dark')
  }

  private setTheme = (nextTheme: ThemeMode) => {
    this.theme = nextTheme

    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = nextTheme
      document.documentElement.style.colorScheme = nextTheme
    }

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
    }
  }

  private getSystemTheme = (): ThemeMode => {
    return typeof window !== 'undefined' && window.matchMedia(SYSTEM_THEME_QUERY).matches ? 'dark' : 'light'
  }

  private hasStoredThemeOverride = () => {
    if (typeof localStorage === 'undefined') return false
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY)
    return storedTheme === 'dark' || storedTheme === 'light'
  }

  private handleSystemThemeChange = () => {
    if (this.hasStoredThemeOverride()) return
    this.setTheme(this.getSystemTheme())
  }
}

export type ThemeControllerApi = ThemeController

export function createThemeController() {
  return new ThemeController()
}
