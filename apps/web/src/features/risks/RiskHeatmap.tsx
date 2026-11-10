import clsx from 'clsx';
import { levelOf, type MethodologyConfig, type Tone } from '@chandelier/shared';
import type { Heatmap, LevelView } from './types';

const cellTone: Record<Tone, string> = {
  green: 'bg-tone-green-bg text-tone-green-fg',
  yellow: 'bg-tone-yellow-bg text-tone-yellow-fg',
  orange: 'bg-tone-orange-bg text-tone-orange-fg',
  red: 'bg-tone-red-bg text-tone-red-fg',
  gray: 'bg-tone-gray-bg text-tone-gray-fg',
  blue: 'bg-tone-blue-bg text-tone-blue-fg',
};

export function LevelBadge({ level, score }: { level: LevelView | null; score?: number | null }) {
  if (!level) return <span className="text-xs text-grey-500">Non coté</span>;
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold',
        cellTone[level.tone],
      )}
    >
      {level.label}
      {score != null && <span className="font-normal">({score})</span>}
    </span>
  );
}

/**
 * Carte de chaleur vraisemblance × gravité, calculée par l'API à partir des risques réels.
 * Les cellules cliquables filtrent la liste.
 */
export function RiskHeatmap({
  config,
  heatmap,
  selected,
  onSelect,
}: {
  config: MethodologyConfig;
  heatmap: Heatmap;
  selected?: string | null;
  onSelect?: (cell: string | null) => void;
}) {
  const rows = [...config.likelihood].reverse();
  return (
    <figure>
      <div className="flex gap-2">
        <div className="flex items-center">
          <span className="-rotate-180 text-xs font-semibold text-grey-600 [writing-mode:vertical-rl]">
            Vraisemblance
          </span>
        </div>
        <table className="border-separate border-spacing-1 text-xs">
          <caption className="sr-only">
            Nombre de risques par vraisemblance et gravité ({heatmap.basis.toLowerCase()})
          </caption>
          <tbody>
            {rows.map((l) => (
              <tr key={l.value}>
                <th scope="row" className="pr-1 text-right font-normal text-grey-600">
                  {l.value}. {l.label}
                </th>
                {config.severity.map((s) => {
                  const key = `${l.value}-${s.value}`;
                  const n = heatmap.cells[key] ?? 0;
                  const lvl = levelOf(config, l.value * s.value)!;
                  const label = `${n} risque(s) — vraisemblance ${l.label}, gravité ${s.label}, niveau ${lvl.label}`;
                  return (
                    <td key={key} className="p-0">
                      <button
                        type="button"
                        disabled={!onSelect || n === 0}
                        aria-pressed={selected === key}
                        aria-label={label}
                        title={label}
                        onClick={() => onSelect?.(selected === key ? null : key)}
                        className={clsx(
                          'h-11 w-14 rounded-md text-sm font-bold disabled:cursor-default',
                          cellTone[lvl.tone],
                          n === 0 && 'opacity-40',
                          selected === key && 'ring-2 ring-gls-blue ring-offset-1',
                        )}
                      >
                        {n || ''}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td />
              {config.severity.map((s) => (
                <th key={s.value} scope="col" className="w-14 text-center font-normal text-grey-600">
                  {s.value}. {s.label}
                </th>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <figcaption className="mt-1 text-center text-xs text-grey-500">
        Gravité · {heatmap.basis}
        {heatmap.excluded > 0 && ` · ${heatmap.excluded} risque(s) non coté(s) ou à recoter non représenté(s)`}
      </figcaption>
    </figure>
  );
}
