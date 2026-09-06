import type { ReactNode } from 'react';

import './globals.css';

/**
 * Racine du rendu HTML.
 *
 * `apps/api` est une API : cette racine ne sert qu'aux quelques pages
 * publiques légales de `[locale]` (CLAUDE.md §2.2). La langue réelle du
 * document est posée par le layout `[locale]`, seul à la connaître ; celle-ci
 * ne fixe que la valeur de repli.
 */
export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return children;
}
