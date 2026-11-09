import { useQuery } from '@tanstack/react-query';
import { get } from './api';
import type { OrgUnit, Page, Tag, User } from './types';

export function useOrgUnits() {
  return useQuery({
    queryKey: ['org-units', false],
    queryFn: () => get<{ items: OrgUnit[] }>('/api/v1/org-units'),
    staleTime: 60_000,
  });
}

/** Utilisateurs actifs (sélecteurs propriétaire / responsable). */
export function useActiveUsers() {
  return useQuery({
    queryKey: ['users', 'active-all'],
    queryFn: () => get<Page<User>>('/api/v1/users?pageSize=200'),
    staleTime: 60_000,
  });
}

export function useTags() {
  return useQuery({ queryKey: ['tags'], queryFn: () => get<{ items: Tag[] }>('/api/v1/tags'), staleTime: 30_000 });
}

export const indent = (depth: number) => '  '.repeat(depth);
