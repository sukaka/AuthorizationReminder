import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

type ThemeChoice = 'system' | 'light' | 'dark';
type ResolvedTheme = Exclude<ThemeChoice, 'system'>;

type ThemeContextValue = {
  choice: ThemeChoice;
  resolvedTheme: ResolvedTheme;
  setChoice: (choice: ThemeChoice) => void;
};

const STORAGE_KEY = 'juxin-ai-theme';
const ThemeContext = createContext<ThemeContextValue | null>(null);

function getStoredChoice(): ThemeChoice {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return value;
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const [choice, setChoiceState] = useState<ThemeChoice>(getStoredChoice);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);
  const resolvedTheme = choice === 'system' ? systemTheme : choice;

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return undefined;

    const update = (event: MediaQueryListEvent) => setSystemTheme(event.matches ? 'dark' : 'light');
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  const setChoice = (nextChoice: ThemeChoice) => {
    setChoiceState(nextChoice);
    localStorage.setItem(STORAGE_KEY, nextChoice);
  };

  const value = useMemo(
    () => ({ choice, resolvedTheme, setChoice }),
    [choice, resolvedTheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
      <div className="theme-switcher" aria-label="外观">
        {([
          ['system', '跟随系统'],
          ['light', '浅色'],
          ['dark', '深色'],
        ] as const).map(([value, label]) => (
          <button
            className={choice === value ? 'is-active' : ''}
            key={value}
            onClick={() => setChoice(value)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
    </ThemeContext.Provider>
  );
}
