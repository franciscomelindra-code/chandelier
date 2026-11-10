import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { DIMENSION_VALUE_META, WORK_STATUS_META, type WorkStatus } from '@chandelier/shared';
import { errorMessage, get } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { Alert, Badge, Card, EmptyState, Spinner } from '../../components/ui';

interface Row {
  system: { id: string; reference: string; name: string; isDemo: boolean };
  fria: {
    requirement: string | null;
    latest: { id: string; version: number; status: WorkStatus; notifiedAuthorityAt: string | null } | null;
  };
  notice: {
    transparency: string | null;
    latest: { id: string; version: number; status: WorkStatus } | null;
    hasValidated: boolean;
  };
  dpias: {
    id: string;
    reference: string;
    title: string;
    status: WorkStatus;
    externalUrl: string;
    conductedOn: string | null;
  }[];
}

const dim = (v: string | null) => (v ? (DIMENSION_VALUE_META[v]?.label ?? v) : 'Non qualifié');
const work = (s: WorkStatus | undefined) =>
  s ? (
    <Badge tone={WORK_STATUS_META[s].tone}>{WORK_STATUS_META[s].label}</Badge>
  ) : (
    <span className="text-grey-400">—</span>
  );

/** Portefeuille FRIA / DPIA / notices : exigences issues de la qualification effective et état des livrables. */
export function CompliancePortfolio({ kind }: { kind: 'fria' | 'dpia' | 'notices' }) {
  const q = useQuery({
    queryKey: ['compliance-portfolio'],
    queryFn: () => get<{ items: Row[] }>('/api/v1/compliance-portfolio'),
  });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="red">{errorMessage(q.error)}</Alert>;
  const rows =
    kind === 'fria'
      ? q.data.items.filter(
          (r) => r.fria.requirement === 'REQUIRED' || r.fria.requirement === 'TO_CONFIRM' || r.fria.latest,
        )
      : kind === 'notices'
        ? q.data.items.filter(
            (r) =>
              r.notice.transparency === 'APPLICABLE' || r.notice.transparency === 'UNDETERMINED' || r.notice.latest,
          )
        : q.data.items.filter((r) => r.dpias.length);
  const link = (r: Row) => (
    <Link to={`/systemes/${r.system.id}?etape=documentation`} className="font-semibold text-gls-blue hover:underline">
      {r.system.reference} — {r.system.name}
    </Link>
  );
  if (!rows.length)
    return (
      <EmptyState>
        {kind === 'fria'
          ? 'Aucun SIA dont la qualification requiert (ou laisse à confirmer) une FRIA, et aucune FRIA engagée.'
          : kind === 'notices'
            ? 'Aucun SIA soumis à des obligations de transparence selon sa qualification, et aucune notice engagée.'
            : 'Aucune DPIA référencée.'}
      </EmptyState>
    );
  return (
    <Card className="!p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            {kind === 'fria' ? 'FRIA' : kind === 'notices' ? 'Notices de transparence' : 'DPIA'}
          </caption>
          <thead className="border-b border-grey-200 bg-grey-50 text-xs uppercase tracking-wide text-grey-500">
            {kind === 'dpia' ? (
              <tr>
                <th className="px-3 py-2">Système</th>
                <th className="px-3 py-2">DPIA</th>
                <th className="px-3 py-2">Statut</th>
                <th className="px-3 py-2">Réalisée le</th>
              </tr>
            ) : (
              <tr>
                <th className="px-3 py-2">Système</th>
                <th className="px-3 py-2">
                  {kind === 'fria' ? 'FRIA (qualification)' : 'Transparence (qualification)'}
                </th>
                <th className="px-3 py-2">Dernière version</th>
                <th className="px-3 py-2">
                  {kind === 'fria' ? 'Notification à l’autorité' : 'Version validée en vigueur'}
                </th>
              </tr>
            )}
          </thead>
          <tbody>
            {kind === 'dpia'
              ? rows.flatMap((r) =>
                  r.dpias.map((d) => (
                    <tr key={d.id} className="border-b border-grey-100">
                      <td className="px-3 py-2.5">{link(r)}</td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-xs text-grey-500">{d.reference}</span> {d.title}
                      </td>
                      <td className="px-3 py-2.5">{work(d.status)}</td>
                      <td className="px-3 py-2.5">{formatDate(d.conductedOn)}</td>
                    </tr>
                  )),
                )
              : rows.map((r) => {
                  const req = kind === 'fria' ? r.fria.requirement : r.notice.transparency;
                  const latest = kind === 'fria' ? r.fria.latest : r.notice.latest;
                  const missing =
                    kind === 'fria'
                      ? req === 'REQUIRED' && latest?.status !== 'VALIDATED'
                      : req === 'APPLICABLE' && !r.notice.hasValidated;
                  return (
                    <tr key={r.system.id} className="border-b border-grey-100">
                      <td className="px-3 py-2.5">
                        {link(r)} {r.system.isDemo && <Badge tone="yellow">DEMO</Badge>}
                      </td>
                      <td className="px-3 py-2.5">
                        {dim(req)} {missing && <Badge tone="orange">Livrable manquant</Badge>}
                      </td>
                      <td className="px-3 py-2.5">
                        {latest ? (
                          <>
                            v{latest.version} {work(latest.status)}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {kind === 'fria'
                          ? formatDate(r.fria.latest?.notifiedAuthorityAt ?? null)
                          : r.notice.hasValidated
                            ? 'Oui'
                            : 'Non'}
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
