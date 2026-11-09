import clsx from 'clsx';
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import type { Tone } from '@chandelier/shared';

// ── Bouton (pilule, charte GLS : bleu primaire, jaune réservé à l'accent) ──
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' }) {
  return (
    <button
      type={type}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-full font-bold transition-[background,transform] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45',
        size === 'sm' ? 'px-4 py-1.5 text-sm' : 'px-5 py-2.5 text-[0.95rem]',
        {
          'border-2 border-gls-blue bg-gls-blue text-white hover:bg-gls-blue-600': variant === 'primary',
          'border-2 border-gls-blue bg-transparent text-gls-blue hover:bg-gls-blue-050': variant === 'secondary',
          'border-2 border-transparent bg-transparent text-gls-blue hover:bg-gls-blue-050': variant === 'ghost',
          'border-2 border-tone-red-fg bg-white text-tone-red-fg hover:bg-tone-red-bg': variant === 'danger',
          'border-2 border-gls-yellow bg-gls-yellow text-gls-blue hover:bg-[#ffdb33]': variant === 'accent',
        },
        className,
      )}
      {...rest}
    />
  );
}

// ── Badge à tonalité sémantique ──
const toneClass: Record<Tone, string> = {
  green: 'bg-tone-green-bg text-tone-green-fg',
  yellow: 'bg-tone-yellow-bg text-tone-yellow-fg',
  orange: 'bg-tone-orange-bg text-tone-orange-fg',
  red: 'bg-tone-red-bg text-tone-red-fg',
  gray: 'bg-tone-gray-bg text-tone-gray-fg',
  blue: 'bg-tone-blue-bg text-tone-blue-fg',
};
export function Badge({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold',
        toneClass[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={clsx('rounded-[var(--radius-card)] bg-white p-6 shadow-card', className)}>{children}</section>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="text-xs font-bold uppercase tracking-[0.06em] text-gls-blue">{eyebrow}</p>}
        <h1 className="text-[1.9rem] leading-tight font-extrabold">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-grey-600">{description}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Alert({ tone = 'blue', title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  return (
    <div
      role={tone === 'red' ? 'alert' : 'status'}
      className={clsx('rounded-xl border-l-4 px-4 py-3', toneClass[tone], {
        'border-tone-red-fg': tone === 'red',
        'border-tone-orange-fg': tone === 'orange',
        'border-tone-yellow-fg': tone === 'yellow',
        'border-tone-green-fg': tone === 'green',
        'border-tone-blue-fg': tone === 'blue',
        'border-tone-gray-fg': tone === 'gray',
      })}
    >
      {title && <p className="font-bold">{title}</p>}
      {children && <div className="text-sm">{children}</div>}
    </div>
  );
}

// ── Champs de formulaire (libellé associé, erreur annoncée) ──
interface FieldProps {
  label: string;
  hint?: string;
  error?: string | undefined;
}
export function TextField({
  label,
  hint,
  error,
  className,
  ...rest
}: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-grey-700">
        {label}
        {rest.required && (
          <span aria-hidden="true" className="text-tone-red-fg">
            {' '}
            *
          </span>
        )}
      </label>
      <input
        id={id}
        aria-invalid={!!error}
        aria-describedby={hint || error ? `${id}-help` : undefined}
        className="w-full rounded-lg border border-grey-300 bg-white px-3 py-2 text-ink placeholder:text-grey-400 focus:border-gls-blue"
        {...rest}
      />
      {(hint || error) && (
        <p id={`${id}-help`} className={clsx('mt-1 text-xs', error ? 'text-tone-red-fg' : 'text-grey-500')}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function SelectField({
  label,
  hint,
  error,
  className,
  children,
  ...rest
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-grey-700">
        {label}
      </label>
      <select
        id={id}
        aria-invalid={!!error}
        className="w-full rounded-lg border border-grey-300 bg-white px-3 py-2 text-ink focus:border-gls-blue"
        {...rest}
      >
        {children}
      </select>
      {(hint || error) && (
        <p className={clsx('mt-1 text-xs', error ? 'text-tone-red-fg' : 'text-grey-500')}>{error ?? hint}</p>
      )}
    </div>
  );
}

// ── Fenêtre modale native <dialog> (focus piégé, Échap) ──
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="modal-title"
      className="m-auto w-[min(640px,calc(100vw-2rem))] rounded-[var(--radius-card)] p-0 shadow-pop backdrop:bg-ink/40"
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-grey-200 px-6 py-4">
            <h2 id="modal-title" className="text-lg">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-2 text-2xl leading-none text-grey-500 hover:text-ink"
              aria-label="Fermer"
            >
              ×
            </button>
          </div>
          <div className="overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-grey-200 px-6 py-4">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm text-grey-600">
      <span>
        {total} élément{total > 1 ? 's' : ''} — page {page} / {pages}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Précédent
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Suivant
        </Button>
      </div>
    </nav>
  );
}

export function Spinner({ label = 'Chargement…' }: { label?: string }) {
  return (
    <p role="status" className="py-8 text-center text-grey-500">
      {label}
    </p>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-grey-300 px-4 py-8 text-center text-grey-500">{children}</p>
  );
}
