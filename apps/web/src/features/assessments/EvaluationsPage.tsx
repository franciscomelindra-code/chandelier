import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ASSESSMENT_STATUS_META } from '@chandelier/shared';
import { errorMessage, get } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { Alert, Badge, Card, EmptyState, PageHeader, SelectField, Spinner } from '../../components/ui';
import { ComplianceBadge, RiskBadge } from '../ai-systems/badges';

interface Row {
  system: { id: string; reference: string; name: string; status: string; isDemo: boolean };
  riskCategory: string;
  complianceStatus: string;
  state: 'NONE' | 'DRAFT' | 'COMPLETED' | 'VALIDATED';
  currentAssessment: { id: string; status: string; computedAt: string | null; effectiveCategory: string | null } | null;
  draftId: string | null;
  obligationCount: number;
}

const STATE_META: Record<Row['state'], { label: string; tone: 'gray' | 'blue' | 'green' | 'orange' }> = {
  NONE: { label: 'Non qualifié', tone: 'orange' },
  DRAFT: { label: 'Qualification en cours', tone: 'blue' },
  COMPLETED: { label: 'Terminée — à valider', tone: 'blue' },
  VALIDATED: { label: 'Validée', tone: 'green' },
};

export function EvaluationsPage() {
  const [status, setStatus] = useState('');
  const q = useQuery({
    queryKey: ['assessments-portfolio', status],
    queryFn: () => get<{ items: Row[] }>(`/api/v1/assessments${status ? `?status=${status}` : ''}`),
  });
  return (
    <>
      <PageHeader
        eyebrow="AI Act"
        title="Évaluations"
        description="Qualification AI Act courante de chaque système d’IA de votre périmètre. Chaque conclusion est explicable depuis l’étape 9 de la fiche."
      />
      <Card className="mb-4 !p-4">
        <SelectField className="w-64" label="État" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tous</option>
          {(Object.keys(STATE_META) as Row['state'][]).map((k) => (
            <option key={k} value={k}>
              {STATE_META[k].label}
            </option>
          ))}
        </SelectField>
      </Card>
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <Alert tone="red">{errorMessage(q.error)}</Alert>
      ) : q.data.items.length === 0 ? (
        <EmptyState>Aucun système ne correspond.</EmptyState>
      ) : (
        <Card className="!p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Qualifications AI Act</caption>
              <thead className="border-b border-grey-200 bg-grey-50 text-xs uppercase tracking-wide text-grey-500">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Système
                  </th>
                  <th scope="col" className="px-3 py-2">
                    État
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Catégorie
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Qualifié le
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Obligations
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Conformité
                  </th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((r) => (
                  <tr key={r.system.id} className="border-b border-grey-100 hover:bg-grey-50">
                    <td className="px-3 py-2.5">
                      <Link
                        to={`/systemes/${r.system.id}?etape=classification`}
                        className="font-semibold text-gls-blue hover:underline"
                      >
                        {r.system.reference} — {r.system.name}
                      </Link>
                      {r.system.isDemo && (
                        <span className="ml-2">
                          <Badge tone="yellow">DEMO</Badge>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={STATE_META[r.state].tone}>{STATE_META[r.state].label}</Badge>
                      {r.currentAssessment && r.state === 'DRAFT' && (
                        <span className="ml-1 text-xs text-grey-500">
                          (courante : {ASSESSMENT_STATUS_META[r.currentAssessment.status]?.label})
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <RiskBadge value={r.riskCategory} />
                    </td>
                    <td className="px-3 py-2.5">{formatDate(r.currentAssessment?.computedAt)}</td>
                    <td className="px-3 py-2.5">{r.obligationCount}</td>
                    <td className="px-3 py-2.5">
                      <ComplianceBadge value={r.complianceStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
