import { z } from 'zod';
import type { AI_SYSTEM_STATUS_META } from './labels.js';
import type { VALUE_LEVEL_META } from './ai-system.js';

/** S10 — import du registre (CSV / JSON) : mapping assisté, aperçu, validation, import transactionnel. */

export const IMPORT_FIELDS = [
  { key: 'name', label: 'Nom', required: true, aliases: ['label', 'nom', 'name', 'libellé', 'libelle', 'intitulé'] },
  { key: 'reference', label: 'Référence', required: false, aliases: ['ref', 'référence', 'reference', 'id externe'] },
  { key: 'description', label: 'Description', required: false, aliases: ['description'] },
  { key: 'purpose', label: 'Finalité', required: false, aliases: ['finalité', 'finalite', 'purpose', 'objectif'] },
  { key: 'status', label: 'Statut', required: false, aliases: ['state', 'statut', 'status'] },
  {
    key: 'orgUnit',
    label: 'Unité (code ou nom)',
    required: false,
    aliases: ['unité', 'unite', 'entité', 'direction', 'orgunit', 'service'],
  },
  {
    key: 'ownerEmail',
    label: 'Propriétaire (e-mail)',
    required: false,
    aliases: ['propriétaire', 'proprietaire', 'owner', 'owneremail', 'responsable'],
  },
  {
    key: 'declaredRiskLevel',
    label: 'Niveau de risque déclaré (informatif, non repris comme qualification)',
    required: false,
    aliases: ['risklevel', 'niveau de risque', 'risque'],
  },
  {
    key: 'declaredRiskJustification',
    label: 'Justification du risque déclaré (informatif)',
    required: false,
    aliases: ['risklevel justification', 'riskleveljustification'],
  },
  {
    key: 'valueLevel',
    label: 'Valeur ajoutée',
    required: false,
    aliases: ['benefitlevel', 'valeur', 'valeur ajoutée'],
  },
  {
    key: 'valueJustification',
    label: 'Justification de la valeur',
    required: false,
    aliases: ['benefitleveljustification', 'justification valeur'],
  },
  {
    key: 'firstDeploymentDate',
    label: 'Date de déploiement',
    required: false,
    aliases: ['datedeployment', 'date de déploiement', 'mise en service'],
  },
  {
    key: 'actualRetirementDate',
    label: 'Date de retrait',
    required: false,
    aliases: ['dateretirement', 'date de retrait'],
  },
  {
    key: 'archivedOn',
    label: 'Date d’archivage',
    required: false,
    aliases: ['datearchived', 'date d’archivage', "date d'archivage"],
  },
  {
    key: 'noticeHtml',
    label: 'Notice de transparence (HTML, importée comme brouillon en texte brut)',
    required: false,
    aliases: ['transparencynoticehtml', 'notice'],
  },
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number]['key'];
export const IMPORT_FIELD_KEYS = IMPORT_FIELDS.map((f) => f.key) as [ImportField, ...ImportField[]];
/** Colonnes connues mais volontairement ignorées (horodatages et indicateurs gérés par Chandelier). */
export const IGNORED_COLUMNS = ['datecreation', 'dateupdate', 'transparencynoticedone'];

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Mapping proposé : colonne → champ (null = ignorée). L'utilisateur le confirme ou le corrige. */
export function suggestMapping(headers: string[]): Record<string, ImportField | null> {
  const out: Record<string, ImportField | null> = {};
  const used = new Set<string>();
  for (const h of headers) {
    const n = norm(h);
    const f = IMPORT_FIELDS.find(
      (x) =>
        !used.has(x.key) &&
        (x.aliases as readonly string[]).some(
          (a) => norm(a) === n || norm(a).replace(/ /g, '') === n.replace(/ /g, ''),
        ),
    );
    out[h] = f ? f.key : null;
    if (f) used.add(f.key);
  }
  return out;
}

export const importMappingSchema = z.strictObject({
  mapping: z.record(z.string().max(200), z.enum(IMPORT_FIELD_KEYS).nullable()),
  defaultOrgUnitId: z.uuid().nullable().default(null),
});

/** Analyse CSV (RFC 4180) : séparateur détecté (; , tabulation), guillemets, retours à la ligne dans les champs, BOM. */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const src = text.replace(/^\ufeff/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const counts = [';', ',', '\t'].map((d) => ({ d, n: firstLine.split(d).length }));
  const delim = counts.sort((a, b) => b.n - a.n)[0]!.d;
  const records: string[][] = [];
  let field = '';
  let rec: string[] = [];
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === delim) {
      rec.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      rec.push(field);
      records.push(rec);
      rec = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || rec.length) {
    rec.push(field);
    records.push(rec);
  }
  const nonEmpty = records.filter((r) => r.some((v) => v.trim() !== ''));
  const [headers = [], ...rows] = nonEmpty;
  return { headers: headers.map((h) => h.trim()), rows };
}

/** Correspondance tolérante d'un libellé ou code vers une valeur d'énumération. */
export function matchEnum<T extends string>(
  value: string,
  meta: Record<T, { label: string }>,
  extra: Record<string, T> = {},
): T | null {
  const n = norm(value);
  if (!n) return null;
  for (const k of Object.keys(meta) as T[]) if (norm(k) === n || norm(meta[k].label) === n) return k;
  return extra[n] ?? null;
}
export const STATUS_ALIASES: Record<string, keyof typeof AI_SYSTEM_STATUS_META> = {
  draft: 'DRAFT',
  active: 'ACTIVE',
  production: 'ACTIVE',
  'en production': 'ACTIVE',
  pilot: 'PILOT',
  retired: 'RETIRED',
  suspended: 'SUSPENDED',
  cancelled: 'CANCELLED',
  canceled: 'CANCELLED',
  'in qualification': 'QUALIFICATION',
};
export const VALUE_ALIASES: Record<string, keyof typeof VALUE_LEVEL_META> = {
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
  eleve: 'HIGH',
  moyen: 'MEDIUM',
  faible: 'LOW',
};

/** Date AAAA-MM-JJ, JJ/MM/AAAA ou ISO complète → AAAA-MM-JJ ; null si vide ; undefined si invalide. */
export function parseDay(v: string): string | null | undefined {
  const s = v.trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return undefined;
}

/** HTML → texte brut (aucune balise conservée) pour reprise en brouillon de notice. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|h[1-6])\s*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
