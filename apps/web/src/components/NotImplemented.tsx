import { Alert, Card, PageHeader } from './ui';

/** Écran honnête pour une fonctionnalité prévue mais non livrée : aucune donnée simulée. */
export function NotImplemented({ title, slice, scope }: { title: string; slice: string; scope: string[] }) {
  return (
    <>
      <PageHeader eyebrow="Chandelier" title={title} />
      <Card>
        <Alert tone="gray" title="Fonctionnalité non implémentée">
          Ce module est prévu dans la tranche {slice} du plan d’implémentation. Aucune donnée n’est affichée tant qu’il
          n’est pas réellement développé et testé.
        </Alert>
        <h2 className="mt-6 mb-2 text-base">Périmètre prévu</h2>
        <ul className="list-disc space-y-1 pl-6 text-grey-700">
          {scope.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </Card>
    </>
  );
}
