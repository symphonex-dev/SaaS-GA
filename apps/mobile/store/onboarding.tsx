import {
  DEFAULT_COUNTRY,
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  type CountryCode,
  type Currency,
  type Locale,
} from '@subscription-manager/shared';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Choix effectués pendant l'onboarding, avant la création de compte
 * (`specs/auth-comptes-rgpd.md` §6).
 *
 * Langue, pays et devise sont **indépendants** : en changer un ne change
 * jamais les autres (CLAUDE.md §4). Ils sont transmis dans le payload de
 * `POST /api/auth/register`, jamais déduits côté serveur.
 */
interface OnboardingContextValue {
  language: Locale;
  country: CountryCode;
  currency: Currency;
  privacyAccepted: boolean;
  setLanguage: (language: Locale) => void;
  setCountry: (country: CountryCode) => void;
  setCurrency: (currency: Currency) => void;
  setPrivacyAccepted: (accepted: boolean) => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({
  children,
  initialLanguage = DEFAULT_LOCALE,
}: {
  children: ReactNode;
  initialLanguage?: Locale;
}): ReactNode {
  const [language, setLanguage] = useState<Locale>(initialLanguage);
  const [country, setCountry] = useState<CountryCode>(DEFAULT_COUNTRY);
  const [currency, setCurrency] = useState<Currency>(DEFAULT_CURRENCY);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

  const value = useMemo<OnboardingContextValue>(
    () => ({
      language,
      country,
      currency,
      privacyAccepted,
      setLanguage,
      setCountry,
      setCurrency,
      setPrivacyAccepted,
    }),
    [language, country, currency, privacyAccepted],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingContextValue {
  const context = useContext(OnboardingContext);

  if (context === null) {
    throw new Error('useOnboarding doit être utilisé dans un OnboardingProvider.');
  }

  return context;
}
