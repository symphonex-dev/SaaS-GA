/**
 * Configuration Tailwind / NativeWind.
 *
 * C'est ainsi que l'exigence « Tailwind CSS, 100 % responsive mobile-first »
 * du projet est satisfaite sur mobile natif (CLAUDE.md §2.3).
 *
 * Aucune dimension de mise en page en pixels fixes : uniquement des espacements
 * relatifs, du flex et des pourcentages (CLAUDE.md §2.5).
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef6ff',
          100: '#d9ebff',
          500: '#2563eb',
          600: '#1d4ed8',
          700: '#1e40af',
        },
        surface: {
          DEFAULT: '#ffffff',
          muted: '#f4f6fa',
          border: '#e2e8f0',
        },
        ink: {
          DEFAULT: '#0f172a',
          muted: '#475569',
          subtle: '#64748b',
        },
        positive: '#047857',
        negative: '#b91c1c',
        warning: '#b45309',
      },
    },
  },
  plugins: [],
};
