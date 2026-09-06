import { useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/controls';
import { Card, Screen } from '../../components/layout';
import { ErrorState, LoadingState, Notice, Pill } from '../../components/states';
import { errorMessage } from '../../lib/errors';
import { useBillingState, useVerifyPurchase } from '../../lib/hooks';
import { loadNativePurchases, plusProductIds } from '../../lib/native-purchases';
import { finishPurchase, purchaseProduct, type PurchaseOutcome } from '../../lib/purchase-flow';

/**
 * Offres Free et Plus (`specs/ui-composants-mobile.md` §11).
 *
 * Deux offres, jamais de « Pro » (CLAUDE.md §1). Les prix ne sont pas codés
 * ici : ils viennent de la fiche produit de la boutique, qui les affiche et les
 * facture (`specs/paiement-in-app.md`). L'application ne saisit ni ne stocke
 * aucune donnée de carte.
 *
 * L'achat passe par le SDK natif du store. Ce module natif **n'existe pas dans
 * Expo Go** : l'écran reste alors entièrement consultable et annonce
 * explicitement que l'achat exige un *development build*. Aucun repli ne
 * simule un achat — seul un jeton réellement délivré par le store, vérifié par
 * le serveur, accorde l'offre Plus (§1 et §4).
 */
const FEATURES = [
  'csvImport',
  'pdfImport',
  'subscriptions',
  'dashboard',
  'priceAlerts',
  'comparison',
  'goals',
  'history',
] as const;

export default function Pricing(): ReactNode {
  const { t } = useTranslation();
  const billing = useBillingState();
  const verifyPurchase = useVerifyPurchase();
  const [outcome, setOutcome] = useState<PurchaseOutcome | null>(null);
  const [purchasing, setPurchasing] = useState<'monthly' | 'yearly' | null>(null);

  const capability = loadNativePurchases();
  const products = plusProductIds();
  const isPlus = billing.data?.plan === 'PLUS';

  function buy(cycle: 'monthly' | 'yearly'): void {
    const productId = cycle === 'monthly' ? products.monthly : products.yearly;

    if (productId === null) {
      setOutcome({ status: 'unavailable', reason: 'NOT_CONFIGURED' });

      return;
    }

    setPurchasing(cycle);
    setOutcome(null);

    void purchaseProduct(productId)
      .then((result) => {
        setOutcome(result);

        if (result.status !== 'verified') {
          return;
        }

        // La preuve part au serveur : c'est lui — et lui seul — qui accorde le
        // plan après vérification auprès de l'API du store.
        verifyPurchase.mutate(result.input, {
          onSuccess: () => {
            // Acquittement seulement maintenant : un achat Android non acquitté
            // sous 3 jours est remboursé automatiquement par Google, et une
            // transaction iOS non terminée est rejouée à chaque lancement.
            void finishPurchase(result.purchase);
          },
        });
      })
      .finally(() => {
        setPurchasing(null);
      });
  }

  const unavailableReason = capability.available ? null : capability.reason;

  return (
    <Screen title={t('billing.pricing.title')} subtitle={t('billing.pricing.subtitle')} showBack>
      <Card>
        <View className="w-full flex-row justify-between gap-3 border-b border-surface-border pb-2">
          <Text className="flex-1 text-sm font-semibold text-ink-muted"> </Text>
          <Text className="w-1/4 text-center text-sm font-semibold text-ink">
            {t('billing.pricing.free')}
          </Text>
          <Text className="w-1/4 text-center text-sm font-semibold text-brand-600">
            {t('billing.pricing.plus')}
          </Text>
        </View>

        {FEATURES.map((feature) => (
          <View
            key={feature}
            accessible
            accessibilityLabel={`${t(`billing.pricing.features.${feature}`)} : ${t('billing.pricing.free')} ${t(`billing.pricing.freeValues.${feature}`)}, ${t('billing.pricing.plus')} ${t(`billing.pricing.plusValues.${feature}`)}`}
            className="w-full flex-row items-center justify-between gap-3 border-b border-surface-border py-3 last:border-b-0"
          >
            <Text className="flex-1 text-sm text-ink">
              {t(`billing.pricing.features.${feature}`)}
            </Text>
            <Text className="w-1/4 text-center text-sm text-ink-muted">
              {t(`billing.pricing.freeValues.${feature}`)}
            </Text>
            <Text className="w-1/4 text-center text-sm font-medium text-ink">
              {t(`billing.pricing.plusValues.${feature}`)}
            </Text>
          </View>
        ))}
      </Card>

      <Notice title={t('billing.pricing.storeNotice')} />

      <Card title={t('billing.purchase.title')}>
        {billing.isLoading ? <LoadingState /> : null}

        {isPlus ? (
          // Le plan affiché est celui **résolu par le serveur** : l'écran ne
          // déduit jamais un droit d'une date (`specs/paiement-in-app.md` §7).
          <Pill label={t('billing.purchase.alreadyPlus')} tone="positive" />
        ) : null}

        {unavailableReason === null ? null : (
          <Notice
            title={t(`billing.purchase.unavailable.${unavailableReason}`)}
            description={t('billing.purchase.unavailableHint')}
            tone="warning"
          />
        )}

        <Button
          label={t('billing.purchase.monthly')}
          disabled={isPlus || unavailableReason !== null || products.monthly === null}
          loading={purchasing === 'monthly' || verifyPurchase.isPending}
          onPress={() => {
            buy('monthly');
          }}
        />
        <Button
          label={t('billing.purchase.yearly')}
          variant="secondary"
          disabled={isPlus || unavailableReason !== null || products.yearly === null}
          loading={purchasing === 'yearly' || verifyPurchase.isPending}
          onPress={() => {
            buy('yearly');
          }}
        />

        {outcome?.status === 'cancelled' ? (
          <Notice title={t('billing.purchase.cancelled')} />
        ) : null}
        {outcome?.status === 'failed' ? (
          <ErrorState message={t(`billing.purchase.failed.${outcome.reason}`)} />
        ) : null}
        {verifyPurchase.isError ? (
          <ErrorState message={errorMessage(verifyPurchase.error, t)} />
        ) : null}
        {verifyPurchase.isSuccess ? (
          <Notice title={t('billing.purchase.verified')} tone="positive" />
        ) : null}

        <Text className="text-xs leading-snug text-ink-subtle">
          {t('billing.purchase.serverNotice')}
        </Text>
      </Card>
    </Screen>
  );
}
