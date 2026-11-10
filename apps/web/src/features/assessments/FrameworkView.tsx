import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DIMENSION_LABELS,
  DIMENSION_VALUE_META,
  OBLIGATION_CATEGORY_LABELS,
  frameworkSchema,
} from '@chandelier/shared';
import { errorMessage, get } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/format';
import { Alert, Badge, Card, SelectField, Spinner } from '../../components/ui';

interface FrameworkRow {
  id: string;
  key: string;
  version: string;
  label: string;
  status: string;
  effectiveFrom: string;
  checksum: string;
  importedAt: string;
}

/** Consultation du référentiel réglementaire (lecture seule : toute évolution passe par une nouvelle version). */
export function FrameworkView() {
  const list = useQuery({
    queryKey: ['frameworks'],
    queryFn: () => get<{ items: FrameworkRow[] }>('/api/v1/regulatory-frameworks'),
  });
  const [selected, setSelected] = useState<string>('');
  const id = selected || list.data?.items.find((f) => f.status === 'ACTIVE')?.id;
  const fw = useQuery({
    queryKey: ['framework', id],
    enabled: !!id,
    staleTime: Infinity,
    queryFn: async () =>
      frameworkSchema.parse((await get<{ content: unknown }>(`/api/v1/regulatory-frameworks/${id}`)).content),
  });
  if (list.isPending) return <Spinner />;
  if (list.isError) return <Alert tone="red">{errorMessage(list.error)}</Alert>;
  const row = list.data.items.find((f) => f.id === id);
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SelectField className="w-96" label="Version" value={id ?? ''} onChange={(e) => setSelected(e.target.value)}>
            {list.data.items.map((f) => (
              <option key={f.id} value={f.id}>
                {f.key} v{f.version} —{' '}
                {f.status === 'ACTIVE' ? 'active' : f.status === 'RETIRED' ? 'retirée' : 'brouillon'}
              </option>
            ))}
          </SelectField>
          {row && (
            <p className="text-xs text-grey-500">
              Importée le {formatDateTime(row.importedAt)} · empreinte SHA-256{' '}
              <span className="font-mono">{row.checksum.slice(0, 16)}…</span>
            </p>
          )}
        </div>
        <p className="mt-3 text-sm text-grey-600">
          Le référentiel est une donnée versionnée (fichier JSON du dépôt, importé au démarrage). Une version importée
          est immuable : toute correction exige une nouvelle version, validée par la Direction juridique. Les
          évaluations conservent la version utilisée.
        </p>
      </Card>
      {fw.isPending && <Spinner />}
      {fw.data && (
        <>
          <Alert tone="yellow" title={fw.data.label}>
            {fw.data.disclaimer}{' '}
            <a className="underline" href={fw.data.legalText.url} target="_blank" rel="noopener noreferrer">
              Texte officiel ↗
            </a>
          </Alert>
          <Card>
            <h2 className="mb-3 text-lg">Questions ({fw.data.questions.length})</h2>
            {fw.data.sections.map((s) => (
              <section key={s.id} className="mb-4">
                <h3 className="text-base">{s.title}</h3>
                <p className="mb-1 text-xs text-grey-500">{s.description}</p>
                <ul className="space-y-1 text-sm">
                  {fw.data.questions
                    .filter((q) => q.section === s.id)
                    .map((q) => (
                      <li key={q.id}>
                        <span className="font-mono text-xs text-grey-500">{q.id}</span> {q.text}{' '}
                        <span className="text-xs text-gls-blue">({q.legalBasis})</span>
                        {q.showIf && <Badge tone="gray">conditionnelle</Badge>}
                      </li>
                    ))}
                </ul>
              </section>
            ))}
          </Card>
          <Card>
            <h2 className="mb-3 text-lg">Règles ({fw.data.rules.length})</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">Règles du référentiel</caption>
                <thead className="border-b border-grey-200 text-grey-500">
                  <tr>
                    <th scope="col" className="py-1 pr-2">
                      Règle
                    </th>
                    <th scope="col" className="py-1 pr-2">
                      Fondement
                    </th>
                    <th scope="col" className="py-1 pr-2">
                      Conclusion
                    </th>
                    <th scope="col" className="py-1 pr-2">
                      Applicable
                    </th>
                    <th scope="col" className="py-1">
                      Explication
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {fw.data.rules.map((r) => (
                    <tr key={r.ruleId} className="border-b border-grey-100 align-top">
                      <td className="py-1.5 pr-2 font-mono">{r.ruleId}</td>
                      <td className="py-1.5 pr-2">{r.legalBasis}</td>
                      <td className="py-1.5 pr-2">
                        {DIMENSION_LABELS[r.output.dimension]} :{' '}
                        {DIMENSION_VALUE_META[r.output.value]?.label ?? r.output.value}
                      </td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">{formatDate(r.effectiveFrom)}</td>
                      <td className="py-1.5">{r.explanation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card>
            <h2 className="mb-3 text-lg">Modèles d’obligations ({fw.data.obligations.length})</h2>
            <ul className="divide-y divide-grey-100 text-sm">
              {fw.data.obligations.map((o) => (
                <li key={o.key} className="py-2">
                  <p className="font-semibold">
                    {o.title} <span className="font-normal text-grey-500">— {o.legalBasis}</span>
                  </p>
                  <p className="text-xs text-grey-600">{o.description}</p>
                  <p className="mt-0.5 flex flex-wrap gap-1 text-xs">
                    <Badge tone="gray">{OBLIGATION_CATEGORY_LABELS[o.category] ?? o.category}</Badge>
                    <Badge tone="blue">Rôles : {o.roles.join(', ')}</Badge>
                    <Badge tone="gray">Dès le {formatDate(o.effectiveFrom)}</Badge>
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
