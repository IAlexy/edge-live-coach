import { fr, TranslationDictionary } from './locales/fr';
import { en } from './locales/en';

export type { TranslationDictionary };
export { fr, en };

export const LOCALE_STORAGE_KEY = 'edge_coach_locale';
export const DEFAULT_LOCALE = 'fr';

export type LocaleChangeListener = (locale: string) => void;

const localesRegistry = new Map<string, TranslationDictionary>([
  ['fr', { ...fr }],
  ['en', { ...en }]
]);

const listeners = new Set<LocaleChangeListener>();

function readStoredLocale(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
      if (saved && localesRegistry.has(saved.toLowerCase())) {
        return saved.toLowerCase();
      }
    }
  } catch {
    // Ignore storage access errors in restricted environments
  }
  return DEFAULT_LOCALE;
}

let currentLocale: string = readStoredLocale();

/**
 * Enregistre dynamiquement une nouvelle langue ou fusionne/remplace un dictionnaire existant.
 * Permet d'étendre facilement l'application vers `es`, `de`, `it`, etc.
 */
export function registerLocale(localeCode: string, dictionary: TranslationDictionary): void {
  const normalized = localeCode.trim().toLowerCase();
  if (!normalized) return;
  const existing = localesRegistry.get(normalized) || {};
  localesRegistry.set(normalized, { ...existing, ...dictionary });
}

/**
 * Retourne la liste des codes de langues disponibles.
 */
export function getAvailableLocales(): string[] {
  return Array.from(localesRegistry.keys());
}

/**
 * Retourne la langue active.
 */
export function getLocale(): string {
  return currentLocale;
}

/**
 * Change la langue active avec persistance dans localStorage et notification des écouteurs.
 * Bascule automatiquement sur `fr` si la langue demandée n'est pas enregistrée.
 */
export function setLocale(localeCode: string): string {
  const normalized = localeCode.trim().toLowerCase();
  const nextLocale = localesRegistry.has(normalized) ? normalized : DEFAULT_LOCALE;
  currentLocale = nextLocale;

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LOCALE_STORAGE_KEY, currentLocale);
    }
  } catch {
    // Ignore storage errors
  }

  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = currentLocale;
  }

  for (const listener of listeners) {
    listener(currentLocale);
  }

  return currentLocale;
}

/**
 * Abonne un écouteur aux changements de langue. Retourne une fonction de désabonnement.
 */
export function onLocaleChange(listener: LocaleChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Traduit une clé avec interpolation optionnelle de variables (`{var}` ou `{{var}}`)
 * et fallback sécurisé vers le français puis vers la clé brute.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const activeDict = localesRegistry.get(currentLocale);
  const fallbackDict = localesRegistry.get(DEFAULT_LOCALE);
  let template = activeDict?.[key] ?? fallbackDict?.[key] ?? key;

  if (params) {
    for (const [paramKey, paramValue] of Object.entries(params)) {
      const valueStr = String(paramValue);
      template = template
        .replace(new RegExp(`\\{\\{${paramKey}\\}\\}`, 'g'), valueStr)
        .replace(new RegExp(`\\{${paramKey}\\}`, 'g'), valueStr);
    }
  }

  return template;
}

/**
 * Applique automatiquement les traductions sur tous les éléments `[data-i18n]`
 * et `[data-i18n-title]` du DOM.
 */
export function applyDomTranslations(root: ParentNode = document): void {
  if (typeof document !== 'undefined' && root === document) {
    document.title = t('app.title');
    if (document.documentElement) {
      document.documentElement.lang = currentLocale;
    }
  }

  const elements = root.querySelectorAll('[data-i18n]');
  elements.forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) {
      el.textContent = t(key);
    }
  });

  const titledElements = root.querySelectorAll('[data-i18n-title]');
  titledElements.forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key) {
      el.setAttribute('title', t(key));
    }
  });
}
