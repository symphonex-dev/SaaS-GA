import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

/**
 * Contrôles interactifs (`specs/ui-composants-mobile.md` §14).
 *
 * Chaque contrôle porte un rôle et un libellé accessibles, une cible tactile
 * confortable, et un état désactivé annoncé aux lecteurs d'écran. Aucune
 * information n'est portée par la seule couleur.
 */
type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 border-brand-600',
  secondary: 'bg-surface border-surface-border',
  danger: 'bg-negative border-negative',
  ghost: 'bg-transparent border-transparent',
};

const VARIANT_TEXT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'text-white',
  secondary: 'text-ink',
  danger: 'text-white',
  ghost: 'text-brand-600',
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
}): ReactNode {
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
      disabled={inactive}
      onPress={onPress}
      className={`w-full flex-row items-center justify-center gap-2 rounded-xl border px-4 py-4 active:opacity-80 ${VARIANT_CLASSES[variant]} ${inactive ? 'opacity-50' : ''}`}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' ? '#0f172a' : '#ffffff'} />
      ) : null}
      <Text className={`text-center text-base font-semibold ${VARIANT_TEXT_CLASSES[variant]}`}>
        {label}
      </Text>
    </Pressable>
  );
}

export function TextField({
  label,
  value,
  onChangeText,
  error,
  hint,
  secureTextEntry = false,
  keyboardType = 'default',
  autoCapitalize = 'none',
  autoComplete,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  error?: string | undefined;
  hint?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address';
  autoCapitalize?: 'none' | 'sentences';
  autoComplete?: 'email' | 'password' | 'new-password' | 'off';
  testID?: string;
}): ReactNode {
  return (
    <View className="w-full gap-1.5">
      <Text className="text-sm font-medium text-ink-muted">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        {...(hint === undefined ? {} : { accessibilityHint: hint })}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        {...(autoComplete === undefined ? {} : { autoComplete })}
        {...(testID === undefined ? {} : { testID })}
        className={`w-full rounded-xl border bg-surface px-4 py-3.5 text-base text-ink ${error === undefined ? 'border-surface-border' : 'border-negative'}`}
      />
      {hint === undefined ? null : <Text className="text-xs text-ink-subtle">{hint}</Text>}
      {error === undefined ? null : (
        // Le message d'erreur est du texte, jamais seulement une bordure rouge.
        <Text accessibilityRole="alert" className="text-sm font-medium text-negative">
          {error}
        </Text>
      )}
    </View>
  );
}

export interface Option<T extends string> {
  value: T;
  label: string;
  description?: string;
}

/**
 * Sélecteur en liste : plus accessible qu'un menu déroulant natif sur mobile,
 * et l'option retenue est annoncée comme sélectionnée (pas seulement colorée).
 */
export function OptionList<T extends string>({
  label,
  options,
  selected,
  onSelect,
  hint,
}: {
  label: string;
  options: readonly Option<T>[];
  selected: T | null;
  onSelect: (value: T) => void;
  hint?: string;
}): ReactNode {
  return (
    <View className="w-full gap-2" accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text className="text-sm font-medium text-ink-muted">{label}</Text>
      {hint === undefined ? null : <Text className="text-xs text-ink-subtle">{hint}</Text>}

      <View className="w-full gap-2">
        {options.map((option) => {
          const isSelected = option.value === selected;

          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected: isSelected }}
              onPress={() => {
                onSelect(option.value);
              }}
              className={`w-full flex-row items-center justify-between gap-3 rounded-xl border px-4 py-3.5 active:opacity-80 ${isSelected ? 'border-brand-600 bg-brand-50' : 'border-surface-border bg-surface'}`}
            >
              <View className="shrink gap-0.5">
                <Text className="text-base font-medium text-ink">{option.label}</Text>
                {option.description === undefined ? null : (
                  <Text className="text-sm text-ink-muted">{option.description}</Text>
                )}
              </View>
              {/* Coche textuelle : l'état sélectionné ne repose pas sur la couleur. */}
              <Text className="text-base font-bold text-brand-600">{isSelected ? '✓' : ''}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Checkbox({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}): ReactNode {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={onToggle}
      className="w-full flex-row items-center gap-3 py-2 active:opacity-70"
    >
      <View
        className={`h-6 w-6 items-center justify-center rounded-md border ${checked ? 'border-brand-600 bg-brand-600' : 'border-surface-border bg-surface'}`}
      >
        <Text className="text-sm font-bold text-white">{checked ? '✓' : ''}</Text>
      </View>
      <Text className="shrink text-base text-ink">{label}</Text>
    </Pressable>
  );
}
