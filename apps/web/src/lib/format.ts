const dt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const d = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });

export const formatDateTime = (iso: string | null | undefined) => (iso ? dt.format(new Date(iso)) : '—');
export const formatDate = (iso: string | null | undefined) => (iso ? d.format(new Date(iso)) : '—');

export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '∅';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '∅';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'oui' : 'non';
  return String(v);
}
