import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { MethodologyConfig } from '@chandelier/shared';
import { RiskHeatmap } from './RiskHeatmap';

const cfg: MethodologyConfig = {
  likelihood: [1, 2, 3].map((value) => ({ value, label: `V${value}` })),
  severity: [1, 2, 3].map((value) => ({ value, label: `G${value}` })),
  thresholds: [
    { min: 1, level: 'LOW', label: 'Faible', tone: 'green' },
    { min: 6, level: 'HIGH', label: 'Élevé', tone: 'red' },
  ],
};

describe('carte de chaleur', () => {
  it('affiche les effectifs fournis par l’API, colore selon les seuils et filtre au clic', () => {
    const onSelect = vi.fn();
    render(
      <RiskHeatmap
        config={cfg}
        heatmap={{ cells: { '3-2': 2 }, excluded: 1, basis: 'Résiduel' }}
        onSelect={onSelect}
      />,
    );
    const cell = screen.getByRole('button', { name: /2 risque\(s\) — vraisemblance V3, gravité G2, niveau Élevé/ });
    expect(cell.className).toMatch(/tone-red/);
    fireEvent.click(cell);
    expect(onSelect).toHaveBeenCalledWith('3-2');
    // Les cellules vides ne sont pas cliquables ; aucune valeur inventée.
    expect(screen.getByRole('button', { name: /0 risque\(s\) — vraisemblance V1, gravité G1/ })).toBeDisabled();
    expect(screen.getByText(/1 risque\(s\) non coté/)).toBeInTheDocument();
  });
});
