import type { ReactNode } from 'react';
import { Linking, Platform, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/controls';
import { Card, Row, Screen } from '../../components/layout';
import { LoadingState, Notice } from '../../components/states';
import { useBillingState } from '../../lib/hooks';
import { intlLocale } from '../../lib/i18n';

/**
 * Gestion de l'abonnement (`specs/ui-composants-mobile.md` §11).
 *
 * L'application **ne réimplémente aucun écran de gestion de carte bancaire** :
 * elle renvoie vers la gestion native du store. Rappel de la règle produit :
 * résilier conserve l'accès payant jusqu'à la fin de la période déjà réglée
 * (CLAUDE.md §5.8).
 *
 * L'offre affichée est celle **résolue par le serveur**
 * (`GET /api/billing/subscription`) : l'écran ne déduit jamais un droit d'une
 * date de fin de période (`specs/paiement-in-app.md` §7).
 */
const STORE_URLS = {
  android: 'https://play.google.com/store/account/subscriptions',
  ios: 'https://apps.apple.com/account/subscriptions',
};

export default function ManageSubscription(): ReactNode {
  const { t, i18n } = useTranslation();
  const locale = intlLocale(i18n.language);
  const isAndroid = Platform.OS === 'android';
  const { data, isLoading } = useBillingState();

  const periodEnd = data?.subscription.currentPeriodEnd ?? null;
  const formattedPeriodEnd =
    periodEnd === null
      ? null
      : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(periodEnd));

  return (
    <Screen title={t('billing.manage.title')} showBack>
      <Card title={t('billing.manage.currentPlan')}>
        {isLoading || data === undefined ? (
          <LoadingState />
        ) : (
          <>
            <Row
              label={t('billing.manage.currentPlan')}
              value={
                data.plan === 'PLUS' ? t('billing.manage.planPlus') : t('billing.manage.planFree')
              }
            />

            {formattedPeriodEnd === null || data.plan === 'FREE' ? (
              <Text className="text-sm text-ink-muted">{t('billing.manage.noSubscription')}</Text>
            ) : (
              <Text className="text-sm text-ink-muted">
                {data.subscription.cancelAtPeriodEnd
                  ? t('billing.manage.accessUntil', { date: formattedPeriodEnd })
                  : t('billing.manage.renewsOn', { date: formattedPeriodEnd })}
              </Text>
            )}
          </>
        )}
      </Card>

      <Card>
        <Text className="text-base leading-relaxed text-ink">
          {t('billing.manage.description')}
        </Text>
        <Text className="text-sm text-ink-muted">
          {isAndroid ? t('billing.manage.androidPath') : t('billing.manage.iosPath')}
        </Text>
      </Card>

      <Notice title={t('billing.manage.cancelNotice')} tone="warning" />

      <Button
        label={t('billing.manage.openStore')}
        onPress={() => {
          void Linking.openURL(isAndroid ? STORE_URLS.android : STORE_URLS.ios);
        }}
      />
    </Screen>
  );
}
