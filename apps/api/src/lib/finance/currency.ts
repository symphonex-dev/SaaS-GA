import {
  SUPPORTED_CURRENCIES,
  isSupportedCurrency,
  type Currency,
  type Money,
} from '@subscription-manager/shared';

/**
 * Multi-devises (`specs/calculs-financiers.md` §7).
 *
 * Règle absolue : **le taux de change n'est jamais inventé**. Aucun
 * fournisseur de taux n'est intégré en V1 ; la conversion est donc désactivée
 * et chaque montant reste exprimé dans sa devise d'origine.
 *
 * Conséquence appliquée partout dans le moteur : les agrégats ne portent que
 * sur une seule devise à la fois. Les dépenses libellées dans une autre devise
 * sont écartées et **signalées explicitement** au client
 * (`DashboardData.unconvertedCurrencies`), jamais additionnées en silence.
 */
export interface ExchangeRateProvider {
  /** Taux décimal exact, sous forme de chaîne (jamais un flottant). */
  getRate(from: string, to: string, date: string): Promise<string>;
}

/** Conversion tracée : la spec §7 exige que le taux reste identifiable. */
export interface ConvertedMoney {
  amount: Money;
  sourceCurrency: Currency;
  targetCurrency: Currency;
  exchangeRate: string;
  rateDate: string;
}

export class ExchangeRateUnavailableError extends Error {
  constructor(from: string, to: string) {
    super(`Aucun taux de change disponible pour ${from} → ${to}.`);
    this.name = 'ExchangeRateUnavailableError';
  }
}

/**
 * Fournisseur par défaut de la V1 : il refuse toute conversion.
 *
 * C'est un choix explicite et documenté, pas un oubli : mieux vaut afficher un
 * montant dans sa devise source avec son code ISO que de le convertir avec un
 * taux arbitraire.
 */
export const noConversionProvider: ExchangeRateProvider = {
  getRate: (from, to) => Promise.reject(new ExchangeRateUnavailableError(from, to)),
};

/** Sépare les montants exprimés dans la devise cible des autres. */
export function partitionByCurrency<T>(
  items: readonly T[],
  currencyOf: (item: T) => string,
  target: Currency,
): { inTarget: T[]; others: Map<string, T[]> } {
  const inTarget: T[] = [];
  const others = new Map<string, T[]>();

  for (const item of items) {
    const currency = currencyOf(item);

    if (currency === target) {
      inTarget.push(item);
      continue;
    }

    const bucket = others.get(currency);

    if (bucket === undefined) {
      others.set(currency, [item]);
      continue;
    }

    bucket.push(item);
  }

  return { inTarget, others };
}

/** Devise de travail de l'utilisateur, avec repli sur EUR si la valeur est corrompue. */
export function resolveCurrency(value: string): Currency {
  return isSupportedCurrency(value) ? value : 'EUR';
}

export function listSupportedCurrencies(): readonly Currency[] {
  return SUPPORTED_CURRENCIES;
}
