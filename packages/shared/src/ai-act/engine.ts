import {
  DIMENSIONS,
  DIMENSION_VALUES,
  MULTI_DIMENSIONS,
  type Answers,
  type Condition,
  type Dimension,
  type DimensionResult,
  type EvaluationResult,
  type Framework,
  type GeneratedObligation,
  type Question,
  type RuleTrace,
} from './types.js';

const isUnknown = (v: Answers[string]) =>
  v === undefined || v === null || v === 'UNKNOWN' || (Array.isArray(v) && v.length === 0);

/** Évalue une condition du mini-langage (aucune exécution de code). */
export function evalCondition(c: Condition, a: Answers, defs: Record<string, Condition>, depth = 0): boolean {
  if (depth > 20) throw new Error('Référentiel invalide : récursion de définitions');
  if ('all' in c) return c.all.every((x) => evalCondition(x, a, defs, depth + 1));
  if ('any' in c) return c.any.some((x) => evalCondition(x, a, defs, depth + 1));
  if ('not' in c) return !evalCondition(c.not, a, defs, depth + 1);
  if ('eq' in c) return a[c.eq[0]] === c.eq[1];
  if ('in' in c) {
    const v = a[c.in[0]];
    return typeof v === 'string' && c.in[1].includes(v);
  }
  if ('includes' in c) {
    const v = a[c.includes[0]];
    return Array.isArray(v) && v.includes(c.includes[1]);
  }
  if ('includesAny' in c) {
    const v = a[c.includesAny[0]];
    return Array.isArray(v) && v.some((x) => c.includesAny[1].includes(x));
  }
  if ('answered' in c) return !isUnknown(a[c.answered]);
  if ('unknown' in c) return isUnknown(a[c.unknown]);
  if ('ref' in c) {
    const d = defs[c.ref];
    if (!d) throw new Error(`Référentiel invalide : définition inconnue « ${c.ref} »`);
    return evalCondition(d, a, defs, depth + 1);
  }
  return true;
}

/** Questions citées par une condition (définitions incluses), pour l'explication. */
export function referencedQuestions(
  c: Condition,
  defs: Record<string, Condition>,
  acc = new Set<string>(),
  depth = 0,
): Set<string> {
  if (depth > 20) return acc;
  if ('all' in c) c.all.forEach((x) => referencedQuestions(x, defs, acc, depth + 1));
  else if ('any' in c) c.any.forEach((x) => referencedQuestions(x, defs, acc, depth + 1));
  else if ('not' in c) referencedQuestions(c.not, defs, acc, depth + 1);
  else if ('eq' in c) acc.add(c.eq[0]);
  else if ('in' in c) acc.add(c.in[0]);
  else if ('includes' in c) acc.add(c.includes[0]);
  else if ('includesAny' in c) acc.add(c.includesAny[0]);
  else if ('answered' in c) acc.add(c.answered);
  else if ('unknown' in c) acc.add(c.unknown);
  else if ('ref' in c && defs[c.ref]) referencedQuestions(defs[c.ref]!, defs, acc, depth + 1);
  return acc;
}

export function isVisible(q: Question, a: Answers, defs: Record<string, Condition>): boolean {
  return !q.showIf || evalCondition(q.showIf, a, defs);
}

const ROLE_FROM_TEMPLATE: Record<string, string> = {
  PROVIDER: 'PROVIDER',
  DEPLOYER: 'DEPLOYER',
  IMPORTER: 'IMPORTER',
  DISTRIBUTOR: 'DISTRIBUTOR',
};

const DISPLAY_LABEL: Record<EvaluationResult['displayCategory'], string> = {
  OUT_OF_SCOPE: 'Hors champ du règlement',
  PROHIBITED: 'Potentiellement interdit',
  UNDETERMINED: 'À déterminer',
  HIGH: 'Haut risque',
  LIMITED: 'Obligations de transparence',
  MINIMAL: 'Risque minimal',
};

/** Catégorie d'affichage dérivée des dimensions — résumé, jamais le raisonnement lui-même. */
export function deriveDisplayCategory(d: Record<Dimension, { value: string }>): {
  category: EvaluationResult['displayCategory'];
  justification: string;
} {
  const v = (k: Dimension) => d[k].value;
  if (v('scope') === 'OUT_OF_SCOPE') {
    return {
      category: 'OUT_OF_SCOPE',
      justification: 'Le dispositif ne relève pas du champ du règlement (définition art. 3(1) ou exclusion art. 2).',
    };
  }
  if (v('prohibited') === 'POTENTIAL') {
    return {
      category: 'PROHIBITED',
      justification:
        'Au moins une hypothèse de pratique interdite (art. 5) est déclarée : analyse juridique immédiate requise.',
    };
  }
  if (v('scope') === 'UNDETERMINED' || v('prohibited') === 'UNDETERMINED' || v('highRisk') === 'UNDETERMINED') {
    return {
      category: 'UNDETERMINED',
      justification:
        'Des informations déterminantes manquent (champ, pratiques interdites ou haut risque) : aucune conclusion favorable n’est retenue par défaut.',
    };
  }
  if (v('highRisk') === 'HIGH_RISK') {
    return {
      category: 'HIGH',
      justification: 'Le système relève d’un cas de haut risque (art. 6(1) / annexe I ou art. 6(2) / annexe III).',
    };
  }
  if (v('transparency') === 'APPLICABLE') {
    return {
      category: 'LIMITED',
      justification:
        'Le système n’est pas à haut risque mais déclenche au moins une obligation de transparence (art. 50).',
    };
  }
  if (v('transparency') === 'UNDETERMINED') {
    return {
      category: 'UNDETERMINED',
      justification: 'Les obligations de transparence (art. 50) ne peuvent pas être déterminées.',
    };
  }
  return {
    category: 'MINIMAL',
    justification: 'Aucun cas d’interdiction, de haut risque ni d’obligation de transparence n’est identifié.',
  };
}
export const displayLabel = (c: EvaluationResult['displayCategory']) => DISPLAY_LABEL[c];

export interface EvaluateOptions {
  /** Date d'évaluation (YYYY-MM-DD) : obligations futures signalées « à venir ». */
  date?: string;
}

/** Moteur pur et déterministe : référentiel + réponses → qualification explicable. */
export function evaluate(fw: Framework, answers: Answers, opts: EvaluateOptions = {}): EvaluationResult {
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const defs = fw.definitions;
  const visible = new Set(fw.questions.filter((q) => isVisible(q, answers, defs)).map((q) => q.id));
  // Les réponses aux questions masquées ne sont pas prises en compte.
  const effective: Answers = Object.fromEntries(Object.entries(answers).filter(([k]) => visible.has(k)));

  const traces: RuleTrace[] = [];
  for (const r of fw.rules) {
    if (r.effectiveTo && r.effectiveTo < date) continue;
    if (!evalCondition(r.condition, effective, defs)) continue;
    const qs = referencedQuestions(r.condition, defs);
    traces.push({
      ruleId: r.ruleId,
      legalBasis: r.legalBasis,
      dimension: r.output.dimension,
      value: r.output.value,
      severity: r.severity,
      explanation: r.explanation,
      sourceUrl: r.sourceUrl,
      effectiveFrom: r.effectiveFrom,
      answers: Object.fromEntries([...qs].map((q) => [q, effective[q] ?? null])),
    });
  }

  const dimensions = {} as Record<Dimension, DimensionResult>;
  for (const d of DIMENSIONS) {
    const order = DIMENSION_VALUES[d] as readonly string[];
    const rules = traces.filter((t) => t.dimension === d);
    const values = [...new Set(rules.map((t) => t.value))].sort((x, y) => order.indexOf(x) - order.indexOf(y));
    if (MULTI_DIMENSIONS.includes(d)) {
      dimensions[d] = { value: values.join(',') || (d === 'roles' ? 'UNDETERMINED' : 'UNDETERMINED'), values, rules };
    } else {
      const top = values[0] ?? 'UNDETERMINED';
      dimensions[d] = {
        value: top,
        values: top === 'UNDETERMINED' && !values.length ? [] : [top],
        rules: rules.filter((t) => t.value === top),
      };
    }
  }

  // Hors champ : les autres dimensions ne s'appliquent pas.
  const outOfScope = dimensions.scope.value === 'OUT_OF_SCOPE';
  if (outOfScope) {
    for (const d of ['prohibited', 'highRisk', 'transparency', 'gpai', 'fria'] as const) {
      dimensions[d] = { value: 'NOT_APPLICABLE', values: [], rules: [] };
    }
  }

  // Obligations : déclenchées par les règles retenues (valeur gagnante de chaque dimension), filtrées par rôle.
  const roles = new Set(dimensions.roles.values);
  const winning = outOfScope
    ? traces.filter((t) => t.dimension === 'scope' || t.dimension === 'roles')
    : traces.filter((t) => MULTI_DIMENSIONS.includes(t.dimension) || dimensions[t.dimension].value === t.value);
  const byKey = new Map<string, GeneratedObligation>();
  for (const t of winning) {
    const rule = fw.rules.find((r) => r.ruleId === t.ruleId)!;
    for (const key of rule.output.obligations) {
      const tpl = fw.obligations.find((o) => o.key === key);
      if (!tpl) throw new Error(`Référentiel invalide : obligation inconnue « ${key} »`);
      const applies = tpl.roles.includes('ANY') || tpl.roles.some((r) => roles.has(ROLE_FROM_TEMPLATE[r] ?? r));
      const undeterminedRoles = roles.size === 0;
      if (!applies && !undeterminedRoles) continue;
      const eff = rule.effectiveFrom > tpl.effectiveFrom ? rule.effectiveFrom : tpl.effectiveFrom;
      const prev = byKey.get(key);
      const effectiveFrom = prev && prev.effectiveFrom < eff ? prev.effectiveFrom : eff;
      byKey.set(key, {
        key,
        title: tpl.title,
        description: tpl.description,
        legalBasis: tpl.legalBasis,
        category: tpl.category,
        applicability: applies ? 'YES' : 'TO_CONFIRM',
        effectiveFrom,
        upcoming: effectiveFrom > date,
        sourceRuleIds: [...new Set([...(prev?.sourceRuleIds ?? []), rule.ruleId])],
        sourceUrl: tpl.sourceUrl,
      });
    }
  }

  const missing = fw.questions
    .filter((q) => q.determinant && visible.has(q.id) && isUnknown(effective[q.id]))
    .map((q) => ({ questionId: q.id, text: q.text, section: q.section }));

  const { category, justification } = deriveDisplayCategory(dimensions);
  return {
    frameworkKey: fw.key,
    frameworkVersion: fw.version,
    evaluatedAt: date,
    dimensions,
    displayCategory: category,
    displayJustification: justification,
    obligations: [...byKey.values()].sort((x, y) => x.key.localeCompare(y.key)),
    missing,
    triggeredRules: traces,
  };
}

export interface OverrideInput {
  dimension: string;
  newValue: string;
  justification: string;
  authorId: string;
  createdAt: string;
}

/**
 * Résultat effectif : résultat calculé + surcharges juristes (la plus récente par dimension l'emporte).
 * Le résultat calculé n'est jamais modifié ; la catégorie d'affichage est recalculée sauf si elle est elle-même surchargée.
 */
export function applyOverrides(
  computed: EvaluationResult,
  overrides: OverrideInput[],
): EvaluationResult & { overridden: string[] } {
  const latest = new Map<string, OverrideInput>();
  for (const o of [...overrides].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) latest.set(o.dimension, o);
  const dimensions = { ...computed.dimensions };
  for (const [dim, o] of latest) {
    if (dim === 'displayCategory') continue;
    if ((DIMENSIONS as readonly string[]).includes(dim)) {
      dimensions[dim as Dimension] = { value: o.newValue, values: [o.newValue], rules: [] };
    }
  }
  const display = latest.get('displayCategory');
  const derived = deriveDisplayCategory(dimensions);
  return {
    ...computed,
    dimensions,
    displayCategory: (display?.newValue as EvaluationResult['displayCategory']) ?? derived.category,
    displayJustification: display
      ? `Catégorie fixée par surcharge juridique : ${display.justification}`
      : latest.size
        ? `${derived.justification} (après surcharge juridique)`
        : derived.justification,
    overridden: [...latest.keys()],
  };
}

/** Contrôles de cohérence d'un référentiel (au-delà du schéma) : références, valeurs, doublons. */
export function validateFramework(fw: Framework): string[] {
  const errors: string[] = [];
  const qIds = new Set(fw.questions.map((q) => q.id));
  const sections = new Set(fw.sections.map((s) => s.id));
  const oKeys = new Set(fw.obligations.map((o) => o.key));
  const check = (c: Condition, where: string) => {
    for (const q of referencedQuestions(c, fw.definitions))
      if (!qIds.has(q)) errors.push(`${where} : question inconnue ${q}`);
    const walk = (x: Condition) => {
      if ('ref' in x && !fw.definitions[x.ref]) errors.push(`${where} : définition inconnue ${x.ref}`);
      if ('all' in x) x.all.forEach(walk);
      if ('any' in x) x.any.forEach(walk);
      if ('not' in x) walk(x.not);
    };
    walk(c);
  };
  if (new Set(fw.questions.map((q) => q.id)).size !== fw.questions.length)
    errors.push('Identifiants de questions en double');
  if (new Set(fw.rules.map((r) => r.ruleId)).size !== fw.rules.length) errors.push('Identifiants de règles en double');
  for (const q of fw.questions) {
    if (!sections.has(q.section)) errors.push(`Question ${q.id} : section inconnue ${q.section}`);
    if (q.type === 'multi' && !q.options?.length) errors.push(`Question ${q.id} : options manquantes`);
    if (q.showIf) check(q.showIf, `Question ${q.id}`);
  }
  for (const [k, d] of Object.entries(fw.definitions)) check(d, `Définition ${k}`);
  for (const r of fw.rules) {
    check(r.condition, `Règle ${r.ruleId}`);
    if (!(DIMENSION_VALUES[r.output.dimension] as readonly string[]).includes(r.output.value)) {
      errors.push(`Règle ${r.ruleId} : valeur ${r.output.value} invalide pour ${r.output.dimension}`);
    }
    for (const o of r.output.obligations)
      if (!oKeys.has(o)) errors.push(`Règle ${r.ruleId} : obligation inconnue ${o}`);
  }
  return errors;
}
