import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { methodologyConfigSchema, type MethodologyConfig } from '@chandelier/shared';
import { api, errorMessage, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate } from '../../lib/format';
import { Alert, Badge, Button, Card, Modal, SelectField, Spinner, TextField } from '../../components/ui';
import { RiskHeatmap } from '../risks/RiskHeatmap';
import { useMethodologies } from '../risks/RiskPage';
import type { Methodology } from '../risks/types';

const TONES = [
  ['green', 'Vert'],
  ['yellow', 'Jaune'],
  ['orange', 'Orange'],
  ['red', 'Rouge'],
] as const;

/** Aperçu : chaque cellule affiche son niveau (aucun risque compté). */
function Preview({ config }: { config: MethodologyConfig }) {
  return <RiskHeatmap config={config} heatmap={{ cells: {}, excluded: 0, basis: 'Aperçu des niveaux par cellule' }} />;
}

function ScaleEditor({
  title,
  scale,
  onChange,
}: {
  title: string;
  scale: MethodologyConfig['likelihood'];
  onChange: (s: MethodologyConfig['likelihood']) => void;
}) {
  return (
    <fieldset className="rounded-xl border border-grey-200 p-3">
      <legend className="px-1 text-sm font-bold">{title}</legend>
      {scale.map((l, i) => (
        <div key={i} className="mb-2 flex items-end gap-2">
          <span className="w-6 pb-2 text-sm font-bold">{l.value}</span>
          <TextField
            className="flex-1"
            label={`Libellé du niveau ${l.value}`}
            value={l.label}
            onChange={(e) => onChange(scale.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
          />
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={scale.length >= 10}
          onClick={() => onChange([...scale, { value: scale.length + 1, label: '' }])}
        >
          + Niveau
        </Button>
        <Button size="sm" variant="ghost" disabled={scale.length <= 2} onClick={() => onChange(scale.slice(0, -1))}>
          − Dernier niveau
        </Button>
      </div>
    </fieldset>
  );
}

function Editor({ base, onDone }: { base: Methodology; onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(base.name);
  const [cfg, setCfg] = useState<MethodologyConfig>(structuredClone(base.config));
  const [error, setError] = useState<string | null>(null);
  const parsed = methodologyConfigSchema.safeParse(cfg);
  const create = useMutation({
    mutationFn: () => post('/api/v1/risk-methodologies', { name, config: cfg }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['risk-methodologies'] });
      onDone();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const t = cfg.thresholds;
  return (
    <Card>
      <h2 className="mb-1 text-lg">Nouvelle version</h2>
      <p className="mb-3 text-sm text-grey-600">
        La version est créée inactive. Son activation ne modifie pas les risques existants : ils conservent leur
        cotation et sont signalés « à recoter ».
      </p>
      {error && <Alert tone="red">{error}</Alert>}
      <TextField className="mb-3 max-w-md" label="Nom" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ScaleEditor
          title="Vraisemblance"
          scale={cfg.likelihood}
          onChange={(likelihood) => setCfg({ ...cfg, likelihood })}
        />
        <ScaleEditor title="Gravité" scale={cfg.severity} onChange={(severity) => setCfg({ ...cfg, severity })} />
      </div>
      <fieldset className="mt-4 rounded-xl border border-grey-200 p-3">
        <legend className="px-1 text-sm font-bold">
          Seuils (score = vraisemblance × gravité, maximum {cfg.likelihood.length * cfg.severity.length})
        </legend>
        {t.map((th, i) => (
          <div key={i} className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-4">
            <TextField
              label="Score minimal"
              type="number"
              min={1}
              value={th.min}
              onChange={(e) =>
                setCfg({ ...cfg, thresholds: t.map((x, j) => (j === i ? { ...x, min: Number(e.target.value) } : x)) })
              }
            />
            <TextField
              label="Code"
              value={th.level}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  thresholds: t.map((x, j) => (j === i ? { ...x, level: e.target.value.toUpperCase() } : x)),
                })
              }
            />
            <TextField
              label="Libellé"
              value={th.label}
              onChange={(e) =>
                setCfg({ ...cfg, thresholds: t.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })
              }
            />
            <SelectField
              label="Couleur"
              value={th.tone}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  thresholds: t.map((x, j) =>
                    j === i ? { ...x, tone: e.target.value as (typeof TONES)[number][0] } : x,
                  ),
                })
              }
            >
              {TONES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </SelectField>
          </div>
        ))}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={t.length >= 6}
            onClick={() =>
              setCfg({
                ...cfg,
                thresholds: [...t, { min: (t[t.length - 1]?.min ?? 0) + 1, level: '', label: '', tone: 'red' }],
              })
            }
          >
            + Seuil
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={t.length <= 2}
            onClick={() => setCfg({ ...cfg, thresholds: t.slice(0, -1) })}
          >
            − Dernier seuil
          </Button>
        </div>
      </fieldset>
      <div className="mt-4">
        {parsed.success ? (
          <Preview config={parsed.data} />
        ) : (
          <Alert tone="orange" title="Configuration incomplète">
            <ul className="list-disc pl-5">
              {parsed.error.issues.map((i, k) => (
                <li key={k}>
                  {i.path.join(' › ')} : {i.message}
                </li>
              ))}
            </ul>
          </Alert>
        )}
      </div>
      <div className="mt-4 flex gap-2">
        <Button
          disabled={!parsed.success || name.trim().length < 3 || create.isPending}
          onClick={() => create.mutate()}
        >
          Créer la version (inactive)
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Annuler
        </Button>
      </div>
    </Card>
  );
}

function ActivateButton({ m }: { m: Methodology }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [j, setJ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () => api('POST', `/api/v1/risk-methodologies/${m.id}/activate`, { justification: j }),
    onSuccess: async () => {
      setOpen(false);
      await qc.invalidateQueries({ queryKey: ['risk-methodologies'] });
      await qc.invalidateQueries({ queryKey: ['risks'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Activer
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Activer ${m.name} v${m.version}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button disabled={j.trim().length < 10 || mut.isPending} onClick={() => mut.mutate()}>
              Activer
            </Button>
          </>
        }
      >
        {error && <Alert tone="red">{error}</Alert>}
        <p className="mb-3 text-sm">
          Les nouveaux risques utiliseront cette version. Les risques existants gardent leur cotation et devront être
          recotés.
        </p>
        <TextField label="Motif (10 caractères minimum)" value={j} onChange={(e) => setJ(e.target.value)} />
      </Modal>
    </>
  );
}

export function MethodologyPanel() {
  const { can } = useAuth();
  const list = useMethodologies();
  const [editFrom, setEditFrom] = useState<Methodology | null>(null);
  const admin = can('settings:manage');
  if (list.isPending) return <Spinner />;
  if (list.isError) return <Alert tone="red">{errorMessage(list.error)}</Alert>;
  return (
    <div className="space-y-4">
      {editFrom && <Editor base={editFrom} onDone={() => setEditFrom(null)} />}
      {list.data.items.map((m) => (
        <Card key={m.id}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg">
              {m.name} v{m.version}{' '}
              {m.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}
            </h2>
            <div className="flex items-center gap-2 text-sm text-grey-600">
              {m.riskCount} risque(s) · créée le {formatDate(m.createdAt)}
              {admin && !editFrom && (
                <Button size="sm" variant="ghost" onClick={() => setEditFrom(m)}>
                  Nouvelle version à partir de celle-ci
                </Button>
              )}
              {admin && !m.isActive && <ActivateButton m={m} />}
            </div>
          </div>
          <Preview config={m.config} />
        </Card>
      ))}
      {!admin && (
        <p className="text-sm text-grey-500">Seul un super administrateur peut créer ou activer une version.</p>
      )}
    </div>
  );
}
