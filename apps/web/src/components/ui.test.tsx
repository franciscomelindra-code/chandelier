import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge, TextField } from './ui';
import { NotImplemented } from './NotImplemented';

describe('composants UI', () => {
  it('associe le libellé au champ (accessibilité)', () => {
    render(<TextField label="Adresse e-mail" required error="Adresse invalide" />);
    const input = screen.getByLabelText(/Adresse e-mail/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Adresse invalide')).toBeInTheDocument();
  });

  it('applique la tonalité sémantique au badge', () => {
    render(<Badge tone="red">Interdit</Badge>);
    expect(screen.getByText('Interdit').className).toMatch(/tone-red/);
  });

  it('affiche explicitement « Fonctionnalité non implémentée » sans données simulées', () => {
    render(<NotImplemented title="Tableau de bord" slice="S8" scope={['KPI']} />);
    expect(screen.getByText('Fonctionnalité non implémentée')).toBeInTheDocument();
    expect(screen.queryByText(/\d+ SIA/)).toBeNull();
  });
});
