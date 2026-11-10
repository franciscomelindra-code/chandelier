import { describe, expect, it } from 'vitest';
import {
  addMonths,
  approvalDecisionSchema,
  extensionOf,
  intervalFor,
  reminderThreshold,
  sanitizeFileName,
  sniffMatches,
  DEFAULT_REVIEW_INTERVALS,
} from './workflow.js';

const bytes = (...b: number[]) => new Uint8Array(b);

describe('contrôle des fichiers déposés', () => {
  it('reconnaît les signatures et refuse une extension trompeuse', () => {
    expect(sniffMatches('pdf', new TextEncoder().encode('%PDF-1.7 ...'))).toBe(true);
    expect(sniffMatches('pdf', new TextEncoder().encode('<html><script>'))).toBe(false);
    expect(sniffMatches('png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(true);
    expect(sniffMatches('zip', bytes(0x50, 0x4b, 0x03, 0x04))).toBe(true);
    expect(sniffMatches('zip', bytes(0x4d, 0x5a))).toBe(false); // exécutable Windows
    expect(sniffMatches('text', new TextEncoder().encode('colonne;valeur\nà;é'))).toBe(true);
    expect(sniffMatches('text', bytes(0x41, 0x00, 0x42))).toBe(false);
  });
  it('nettoie les noms de fichiers et extrait l’extension', () => {
    expect(sanitizeFileName('..\\..\\etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('a"b<c>.pdf')).toBe('a_b_c_.pdf');
    expect(extensionOf('Rapport.Final.PDF')).toBe('pdf');
    expect(extensionOf('sans-extension')).toBe('');
  });
});

describe('revues et rappels', () => {
  it('ajoute des mois en bornant la fin de mois', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-10', 12)).toBe('2027-11-10');
  });
  it('périodicité selon la catégorie AI Act', () => {
    expect(intervalFor(DEFAULT_REVIEW_INTERVALS, 'HIGH')).toBe(6);
    expect(intervalFor(DEFAULT_REVIEW_INTERVALS, 'MINIMAL')).toBe(12);
  });
  it('seuils de rappel 90/60/30/7 et dépassement', () => {
    expect(reminderThreshold(120)).toBeNull();
    expect(reminderThreshold(90)).toBe(90);
    expect(reminderThreshold(45)).toBe(60);
    expect(reminderThreshold(7)).toBe(7);
    expect(reminderThreshold(0)).toBe(7);
    expect(reminderThreshold(-1)).toBe(0);
  });
  it('un rejet exige un motif', () => {
    expect(approvalDecisionSchema.safeParse({ decision: 'REJECTED', comment: 'non' }).success).toBe(false);
    expect(approvalDecisionSchema.safeParse({ decision: 'APPROVED' }).success).toBe(true);
  });
});
