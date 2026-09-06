import { Tabs } from 'expo-router';
import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';

/**
 * Navigation principale (`specs/ui-composants-mobile.md` §2).
 *
 * Cinq onglets, pas un de plus : aucune fonctionnalité hors V1 (espace
 * famille, widgets, chatbot libre) n'apparaît dans la navigation.
 *
 * Les icônes sont textuelles : chaque onglet reste lisible par un lecteur
 * d'écran et à grande taille de police, sans dépendre d'une police d'icônes.
 */
function TabIcon({ glyph, focused }: { glyph: string; focused: boolean }): ReactNode {
  return (
    <Text
      accessibilityElementsHidden
      importantForAccessibility="no"
      className={`text-lg ${focused ? 'opacity-100' : 'opacity-50'}`}
    >
      {glyph}
    </Text>
  );
}

export default function TabsLayout(): ReactNode {
  const { t } = useTranslation();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#1d4ed8',
        tabBarInactiveTintColor: '#64748b',
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: t('dashboard.title'),
          tabBarAccessibilityLabel: t('dashboard.title'),
          tabBarIcon: ({ focused }) => <TabIcon glyph="▦" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: t('transactions.title'),
          tabBarAccessibilityLabel: t('transactions.title'),
          tabBarIcon: ({ focused }) => <TabIcon glyph="↔" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="subscriptions"
        options={{
          title: t('subscriptions.title'),
          tabBarAccessibilityLabel: t('subscriptions.title'),
          tabBarIcon: ({ focused }) => <TabIcon glyph="↻" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="savings"
        options={{
          title: t('savings.title'),
          tabBarAccessibilityLabel: t('savings.title'),
          tabBarIcon: ({ focused }) => <TabIcon glyph="◎" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('settings.title'),
          tabBarAccessibilityLabel: t('settings.title'),
          tabBarIcon: ({ focused }) => <TabIcon glyph="⚙" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
