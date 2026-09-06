import type { ComparisonOfferMatchDto } from '@subscription-manager/shared';
import { useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import { Linking, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/controls';
import { Card, Divider, Row, Screen, SectionTitle } from '../../components/layout';
import { EmptyState, ErrorState, LoadingState, Notice, Pill } from '../../components/states';
import { errorMessage } from '../../lib/errors';
import { useComparison, useRefreshComparison } from '../../lib/hooks';
import { intlLocale } from '../../lib/i18n';
import { formatMoney } from '../../lib/money';

/**
 * Comparaison d'offres (`specs/ui-composants-mobile.md` §7,
 * `specs/comparateur-et-assistant-ia.md` A.5).
 *
 * Tout vient de `GET /api/comparisons/:expenseId` : coût actuel, coût annuel de
 * chaque alternative, économie et pourcentage sont calculés par le serveur.
 * Cet écran n'estime rien (CLAUDE.md §5.1).
 *
 * Garanties d'affichage tenues ici :
 *  - dates de dernière et de prochaine vérification **toujours** affichées ;
 *  - lien officiel toujours présent ; lien affilié explicitement identifié,
 *    avec sa mention de commission à côté immédiat (A.5) ;
 *  - une offre non fraîche est marquée obsolète et n'est jamais présentée
 *    comme recommandée (A.6) ;
 *  - aucune alternative fiable → « aucune alternative vérifiée », jamais un
 *    résultat forcé (A.2).
 */
function formatDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
}

function OfferCard({
  match,
  locale,
  t,
}: {
  match: ComparisonOfferMatchDto;
  locale: string;
  t: ReturnType<typeof useTranslation>['t'];
}): ReactNode {
  const { offer } = match;
  const hasSavings = match.potentialSavings.minorUnits !== '0';

  return (
    <Card title={offer.serviceName}>
      <View className="flex-row flex-wrap gap-2">
        {/* La fraîcheur est doublée d'un texte : jamais portée par la couleur seule. */}
        <Pill
          label={
            match.freshness === 'FRESH'
              ? t('comparison.freshnessFresh')
              : match.freshness === 'STALE'
                ? t('comparison.freshnessStale')
                : t('comparison.freshnessExpired')
          }
          tone={match.freshness === 'FRESH' ? 'positive' : 'warning'}
        />
        {match.matchKind === 'SUGGESTED' ? (
          <Pill label={t('comparison.matchSuggested')} tone="warning" />
        ) : null}
      </View>

      <Text className="text-base leading-relaxed text-ink">
        {t('comparison.alternativeCost', { annual: formatMoney(match.annualCost, locale) })}
      </Text>

      <Divider />

      <Row label={t('comparison.monthlyCost')} value={formatMoney(match.monthlyCost, locale)} />
      <Row label={t('comparison.annualCost')} value={formatMoney(match.annualCost, locale)} />
      <Text className="text-sm text-ink-muted">
        {offer.commitmentDuration === null
          ? t('comparison.noCommitment')
          : t('comparison.commitment', { months: offer.commitmentDuration })}
      </Text>

      <Text className="text-base font-medium leading-relaxed text-ink">
        {hasSavings && match.potentialSavingsPercentage !== null
          ? t('comparison.savings', {
              amount: formatMoney(match.potentialSavings, locale),
              percentage: match.potentialSavingsPercentage,
            })
          : t('comparison.noSavings')}
      </Text>

      {offer.featuresIncluded.length === 0 ? null : (
        <Text className="text-sm text-ink-muted">
          {`${t('comparison.features')} : ${offer.featuresIncluded.join(', ')}`}
        </Text>
      )}

      <Divider />

      {/* Fraîcheur et provenance sont systématiquement affichées (A.5). */}
      <Text className="text-xs text-ink-muted">
        {t('comparison.lastVerified', { date: formatDate(offer.lastVerifiedAt, locale) })}
      </Text>
      <Text className="text-xs text-ink-muted">
        {t('comparison.nextCheck', { date: formatDate(offer.nextCheckAt, locale) })}
      </Text>

      <Button
        label={t('comparison.openOffer')}
        variant="secondary"
        onPress={() => {
          void Linking.openURL(offer.directOfficialUrl);
        }}
      />

      {offer.affiliateUrl === null || offer.affiliateNote === null ? null : (
        <View className="gap-2">
          {/* La mention de commission est à proximité immédiate du lien, jamais
              reléguée dans une page légale (A.5). */}
          <Notice title={t('comparison.affiliateNotice')} tone="info" />
          <Button
            label={t('comparison.openAffiliate')}
            variant="ghost"
            onPress={() => {
              void Linking.openURL(offer.affiliateUrl ?? offer.directOfficialUrl);
            }}
          />
        </View>
      )}
    </Card>
  );
}

export default function Comparison(): ReactNode {
  const { t, i18n } = useTranslation();
  const locale = intlLocale(i18n.language);
  const params = useLocalSearchParams<{ expenseId: string }>();
  const expenseId = typeof params.expenseId === 'string' ? params.expenseId : '';

  const { data, isLoading, isError, error } = useComparison(expenseId);
  const refresh = useRefreshComparison();

  if (isLoading) {
    return (
      <Screen title={t('comparison.title')} showBack>
        <LoadingState />
      </Screen>
    );
  }

  if (isError || data === undefined) {
    return (
      <Screen title={t('comparison.title')} showBack>
        <ErrorState message={errorMessage(error, t)} />
      </Screen>
    );
  }

  return (
    <Screen
      title={t('comparison.title')}
      subtitle={data.merchant}
      showBack
      footer={
        <View className="w-full gap-2">
          <Button
            label={t('comparison.refresh')}
            variant="secondary"
            loading={refresh.isPending}
            onPress={() => {
              refresh.mutate(expenseId);
            }}
          />
          <Text className="text-xs leading-snug text-ink-muted">{t('comparison.refreshHint')}</Text>
        </View>
      }
    >
      <Card title={t('comparison.currentPlan')}>
        <Text className="text-base leading-relaxed text-ink">
          {data.currentAnnualCost === null
            ? '—'
            : t('comparison.currentCost', {
                annual: formatMoney(data.currentAnnualCost, locale),
              })}
        </Text>

        {data.currentMonthlyCost === null ? null : (
          <Row
            label={t('comparison.monthlyCost')}
            value={formatMoney(data.currentMonthlyCost, locale)}
          />
        )}
      </Card>

      {data.offers.length === 0 ? (
        // Formulation exigée par la spec §7 quand aucune offre vérifiée ne
        // correspond : on ne force jamais un résultat.
        <EmptyState title={t('comparison.none')} />
      ) : (
        <>
          <SectionTitle>{t('comparison.title')}</SectionTitle>
          {data.offers.map((match) => (
            <OfferCard key={match.offer.id} match={match} locale={locale} t={t} />
          ))}
        </>
      )}
    </Screen>
  );
}
