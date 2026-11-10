import { z } from 'zod';
import type { EnumMeta } from './labels.js';

/** S9 — FRIA (art. 27), références DPIA / AIPD, notices de transparence. */

export const WORK_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'IN_REVIEW', 'VALIDATED', 'WITHDRAWN'] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];
export const WORK_STATUS_META: Record<WorkStatus, EnumMeta> = {
  NOT_STARTED: { label: 'Non commencée', tone: 'gray' },
  IN_PROGRESS: { label: 'En cours', tone: 'yellow' },
  IN_REVIEW: { label: 'En relecture', tone: 'blue' },
  VALIDATED: { label: 'Validée', tone: 'green' },
  WITHDRAWN: { label: 'Retirée', tone: 'gray' },
};

// ───────────── FRIA ─────────────

/** Contenu minimal de l'analyse d'impact sur les droits fondamentaux — art. 27(1) a) à f) du règlement (UE) 2024/1689. */
export const FRIA_SECTIONS = [
  {
    key: 'process',
    ref: 'art. 27(1)(a)',
    label: 'Processus du déployeur',
    guidance: 'Description des processus dans lesquels le système est utilisé, conformément à sa destination.',
  },
  {
    key: 'periodFrequency',
    ref: 'art. 27(1)(b)',
    label: 'Période et fréquence d’utilisation',
    guidance: 'Période pendant laquelle et fréquence à laquelle le système est destiné à être utilisé.',
  },
  {
    key: 'affectedPersons',
    ref: 'art. 27(1)(c)',
    label: 'Personnes et groupes concernés',
    guidance: 'Catégories de personnes physiques et groupes susceptibles d’être concernés dans ce contexte.',
  },
  {
    key: 'specificRisks',
    ref: 'art. 27(1)(d)',
    label: 'Risques spécifiques de préjudice',
    guidance:
      'Risques de préjudice susceptibles d’avoir une incidence sur ces catégories, compte tenu des informations du fournisseur (art. 13).',
  },
  {
    key: 'humanOversight',
    ref: 'art. 27(1)(e)',
    label: 'Mesures de contrôle humain',
    guidance: 'Mise en œuvre des mesures de contrôle humain, conformément à la notice d’utilisation.',
  },
  {
    key: 'mitigation',
    ref: 'art. 27(1)(f)',
    label: 'Mesures en cas de matérialisation des risques',
    guidance:
      'Mesures à prendre si les risques se matérialisent, y compris la gouvernance interne et les mécanismes de traitement des plaintes.',
  },
] as const;
export type FriaSectionKey = (typeof FRIA_SECTIONS)[number]['key'];
export const FRIA_SECTION_KEYS = FRIA_SECTIONS.map((s) => s.key) as [FriaSectionKey, ...FriaSectionKey[]];
/** Longueur minimale d'une section renseignée pour pouvoir soumettre la FRIA. */
export const FRIA_MIN_SECTION_LENGTH = 30;

export const friaUpdateSchema = z.strictObject({
  sections: z.partialRecord(z.enum(FRIA_SECTION_KEYS), z.string().max(10_000)).optional(),
  dpiaId: z.uuid().nullable().optional(),
  coveredByDpia: z.array(z.enum(FRIA_SECTION_KEYS)).max(FRIA_SECTION_KEYS.length).optional(),
  conclusion: z.string().max(10_000).optional(),
});

/** Sections manquantes : ni renseignées (≥ 30 caractères), ni couvertes par la DPIA liée. */
export function friaMissingSections(
  sections: Partial<Record<string, string>>,
  covered: string[],
  dpiaTopics: string[] | null,
): FriaSectionKey[] {
  return FRIA_SECTION_KEYS.filter((k) => {
    if (covered.includes(k) && dpiaTopics?.includes(k)) return false;
    return (sections[k] ?? '').trim().length < FRIA_MIN_SECTION_LENGTH;
  });
}

// ───────────── DPIA ─────────────

export const dpiaSchema = z.strictObject({
  title: z.string().trim().min(3).max(200),
  processingActivityId: z.uuid().nullable().default(null),
  status: z.enum(WORK_STATUSES).default('NOT_STARTED'),
  /** Lien vers l'outil tiers (jamais appelé par le serveur : pas de SSRF). */
  externalUrl: z
    .string()
    .trim()
    .max(500)
    .refine((u) => u === '' || /^https?:\/\/[^\s]+$/i.test(u), 'URL http(s) attendue')
    .default(''),
  conductedOn: z.iso.date().nullable().default(null),
  conclusion: z.string().trim().max(10_000).default(''),
  coveredTopics: z.array(z.enum(FRIA_SECTION_KEYS)).max(FRIA_SECTION_KEYS.length).default([]),
});
export const dpiaUpdateSchema = dpiaSchema.partial();

// ───────────── Notices de transparence ─────────────

export const NOTICE_BLOCKS = [
  {
    key: 'aiInteraction',
    label: 'Interaction avec un système d’IA',
    ref: 'art. 50(1)',
    trigger: 'T_INTERACTS',
  },
  {
    key: 'syntheticContent',
    label: 'Contenus générés ou manipulés par IA',
    ref: 'art. 50(2)',
    trigger: 'T_SYNTHETIC',
  },
  {
    key: 'emotionBiometric',
    label: 'Reconnaissance des émotions / catégorisation biométrique',
    ref: 'art. 50(3)',
    trigger: 'T_EMOTION_BIOMETRIC',
  },
  { key: 'deepfake', label: 'Hypertrucage (deepfake)', ref: 'art. 50(4)', trigger: 'T_DEEPFAKE' },
  {
    key: 'publicText',
    label: 'Texte publié pour informer le public',
    ref: 'art. 50(4) al. 2',
    trigger: 'T_PUBLIC_TEXT',
  },
  {
    key: 'decisionSupport',
    label: 'Décision ou recommandation concernant des personnes',
    ref: 'art. 26(11) et 86',
    trigger: 'H_DECISIONS_PERSONS',
  },
  { key: 'humanContact', label: 'Contact humain et recours', ref: 'RGPD art. 12 à 22', trigger: null },
] as const;
export type NoticeBlock = (typeof NOTICE_BLOCKS)[number]['key'];
export const NOTICE_BLOCK_KEYS = NOTICE_BLOCKS.map((b) => b.key) as [NoticeBlock, ...NoticeBlock[]];

/** Blocs proposés d'après les réponses de la qualification (à confirmer par l'utilisateur). */
export function suggestedBlocks(answers: Record<string, unknown> | null): NoticeBlock[] {
  const out: NoticeBlock[] = [];
  for (const b of NOTICE_BLOCKS) {
    if (b.trigger === null || (answers && answers[b.trigger] === 'YES')) out.push(b.key);
  }
  return out;
}

export interface NoticeSource {
  organization: string;
  contact: string;
  system: { name: string; reference: string; purpose: string; functioning: string };
  models: { name: string; vendor: string | null }[];
  processesPersonalData: string;
  hasHumanOversight: boolean;
}

const placeholder = (what: string) => `[À compléter : ${what}]`;
const line = (s: string, fallback: string) => (s.trim() ? s.trim() : placeholder(fallback));

/**
 * Génère la notice en Markdown à partir des données structurées. Déterministe : aucune IA.
 * Les informations absentes sont signalées « [À compléter : …] » plutôt qu'inventées.
 */
export function generateNotice(src: NoticeSource, blocks: NoticeBlock[]): string {
  const has = (b: NoticeBlock) => blocks.includes(b);
  const out: string[] = [];
  out.push(`# Information sur l’utilisation d’un système d’intelligence artificielle`);
  out.push('');
  out.push(`**Service concerné :** ${src.system.name}`);
  out.push(`**Responsable :** ${line(src.organization, 'nom de l’organisation')}`);
  out.push('');
  out.push(`## À quoi sert ce système`);
  out.push(line(src.system.purpose, 'finalité du système (étape 1 de la fiche)'));
  if (src.system.functioning.trim()) {
    out.push('');
    out.push(src.system.functioning.trim());
  }
  if (src.models.length) {
    out.push('');
    out.push(
      `Ce service s’appuie sur : ${src.models.map((m) => (m.vendor ? `${m.name} (${m.vendor})` : m.name)).join(', ')}.`,
    );
  }
  if (has('aiInteraction')) {
    out.push('', `## Vous échangez avec un système d’IA`);
    out.push(
      'Les réponses que vous recevez dans ce service sont produites par un système d’intelligence artificielle, et non par une personne.',
    );
  }
  if (has('syntheticContent')) {
    out.push('', `## Contenus générés par IA`);
    out.push(
      'Certains contenus (textes, images, sons ou vidéos) sont générés ou modifiés par un système d’IA. Ils sont signalés comme tels.',
    );
  }
  if (has('emotionBiometric')) {
    out.push('', `## Reconnaissance des émotions ou catégorisation biométrique`);
    out.push(
      'Ce service utilise un système de reconnaissance des émotions ou de catégorisation biométrique. Les données correspondantes sont traitées conformément au RGPD.',
    );
  }
  if (has('deepfake')) {
    out.push('', `## Contenus hypertruqués`);
    out.push(
      'Des images, sons ou vidéos présentés dans ce service ont été générés ou manipulés artificiellement et peuvent sembler authentiques.',
    );
  }
  if (has('publicText')) {
    out.push('', `## Textes générés par IA`);
    out.push('Des textes publiés pour informer le public ont été générés ou manipulés par un système d’IA.');
  }
  if (has('decisionSupport')) {
    out.push('', `## Décisions vous concernant`);
    out.push(
      src.hasHumanOversight
        ? 'Ce système aide à prendre des décisions ou à formuler des recommandations vous concernant. Une personne examine le résultat avant toute décision.'
        : `Ce système aide à prendre des décisions ou à formuler des recommandations vous concernant. ${placeholder('modalités de contrôle humain')}`,
    );
    out.push(
      'Vous pouvez demander des explications claires et pertinentes sur le rôle du système d’IA dans la décision.',
    );
  }
  if (src.processesPersonalData === 'YES') {
    out.push('', `## Vos données personnelles`);
    out.push(
      'Des données personnelles sont traitées par ce service. Vous disposez des droits prévus par le RGPD (accès, rectification, effacement, limitation, opposition, portabilité).',
    );
  }
  if (has('humanContact')) {
    out.push('', `## Contact et recours`);
    out.push(`Pour toute question, ou pour demander l’intervention d’une personne : ${line(src.contact, 'contact')}.`);
    out.push(
      'Vous pouvez également introduire une réclamation auprès de la CNIL (www.cnil.fr) ou de l’autorité de surveillance compétente.',
    );
  }
  out.push('', `---`, `Référence interne : ${src.system.reference}`);
  return out.join('\n');
}

export const noticeUpdateSchema = z.strictObject({
  blocks: z.array(z.enum(NOTICE_BLOCK_KEYS)).max(NOTICE_BLOCK_KEYS.length).optional(),
  contentMarkdown: z.string().max(50_000).optional(),
});
export const noticeSettingsSchema = z.strictObject({
  organization: z.string().trim().max(200),
  contact: z.string().trim().max(500),
});

// ───────────── Markdown sûr (sous-ensemble) ─────────────

export type MdBlock =
  { kind: 'h1' | 'h2' | 'h3' | 'p'; text: string } | { kind: 'ul'; items: string[] } | { kind: 'hr' };

/** Analyse d'un sous-ensemble de Markdown (titres, paragraphes, listes, séparateur) — sans HTML. */
export function parseMarkdown(md: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  let list: string[] | null = null;
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', text: para.join(' ') });
    para = [];
    if (list) blocks.push({ kind: 'ul', items: list });
    list = null;
  };
  for (const raw of md.replace(/\r\n/g, '\n').split('\n')) {
    const l = raw.trimEnd();
    if (!l.trim()) {
      flush();
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(l);
    if (h) {
      flush();
      blocks.push({ kind: (['h1', 'h2', 'h3'] as const)[h[1]!.length - 1]!, text: h[2]! });
      continue;
    }
    if (/^-{3,}$/.test(l.trim())) {
      flush();
      blocks.push({ kind: 'hr' });
      continue;
    }
    const li = /^\s*[-*]\s+(.*)$/.exec(l);
    if (li) {
      if (para.length) {
        blocks.push({ kind: 'p', text: para.join(' ') });
        para = [];
      }
      (list ??= []).push(li[1]!);
      continue;
    }
    if (list) {
      blocks.push({ kind: 'ul', items: list });
      list = null;
    }
    // Une ligne commençant par **…** forme son propre paragraphe (ex. « **Service :** … »).
    if (/^\*\*/.test(l) && para.length) {
      blocks.push({ kind: 'p', text: para.join(' ') });
      para = [];
    }
    para.push(l.trim());
    if (/^\*\*/.test(l)) {
      blocks.push({ kind: 'p', text: para.join(' ') });
      para = [];
    }
  }
  flush();
  return blocks;
}

/** Segments en ligne : texte simple ou gras (**…**). */
export function inlineSegments(text: string): { bold: boolean; text: string }[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((s) =>
      s.startsWith('**') && s.endsWith('**') ? { bold: true, text: s.slice(2, -2) } : { bold: false, text: s },
    );
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Export HTML autonome : tout le texte est échappé, aucun HTML fourni par l'utilisateur n'est interprété. */
export function markdownToHtml(md: string, title: string): string {
  const inline = (t: string) =>
    inlineSegments(t)
      .map((s) => (s.bold ? `<strong>${esc(s.text)}</strong>` : esc(s.text)))
      .join('');
  const body = parseMarkdown(md)
    .map((b) =>
      b.kind === 'ul'
        ? `<ul>${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`
        : b.kind === 'hr'
          ? '<hr>'
          : `<${b.kind}>${inline(b.text)}</${b.kind}>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;line-height:1.55;color:#1d1d1b}h1{color:#061ab1}h2{color:#061ab1;margin-top:1.6rem}</style>
</head><body>
${body}
</body></html>
`;
}
