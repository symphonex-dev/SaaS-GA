import type { ReactNode } from 'react';

/**
 * Gabarit commun des pages légales.
 *
 * Chaque page porte sa date de dernière révision : un document légal sans date
 * de version n'est pas opposable, et les boutiques la réclament.
 */
export function LegalPage({
  title,
  updatedAtLabel,
  children,
}: {
  title: string;
  updatedAtLabel: string;
  children: ReactNode;
}): ReactNode {
  return (
    <main>
      <h1>{title}</h1>
      <p className="updated">{updatedAtLabel}</p>
      {children}
    </main>
  );
}

/** Section titrée : un `h2` suivi de son contenu, pour garder une structure lisible. */
export function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** Liste à puces simple, sans style dépendant de la couleur seule. */
export function List({ items }: { items: readonly string[] }): ReactNode {
  return (
    <ul>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
