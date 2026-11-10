import { z } from 'zod';
import { ORG_UNIT_TYPES } from './labels.js';
import { ROLE_KEYS } from './permissions.js';

/** Règles de mot de passe local (OWASP ASVS 2.1) : longueur, pas de règles de composition arbitraires. */
export const PASSWORD_MIN_LENGTH = 12;
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `${PASSWORD_MIN_LENGTH} caractères minimum`)
  .max(256, '256 caractères maximum');

export const emailSchema = z.string().trim().toLowerCase().max(254).email('Adresse e-mail invalide');

export const loginSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(256),
});

export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordSchema,
});

const displayName = z.string().trim().min(2).max(120);
const uuid = z.uuid();

export const roleAssignmentInputSchema = z.strictObject({
  roleKey: z.enum(ROLE_KEYS),
  orgUnitId: uuid.nullable(),
  includeDescendants: z.boolean().default(true),
});

export const userCreateSchema = z.strictObject({
  email: emailSchema,
  displayName,
  /** LOCAL : mot de passe temporaire ; OIDC : connexion Microsoft Entra ID uniquement, sans mot de passe. */
  authProvider: z.enum(['LOCAL', 'OIDC']).default('LOCAL'),
  orgUnitId: uuid.nullable().optional(),
  roles: z.array(roleAssignmentInputSchema).max(20).default([]),
});

export const userUpdateSchema = z.strictObject({
  displayName: displayName.optional(),
  orgUnitId: uuid.nullable().optional(),
  isActive: z.boolean().optional(),
  roles: z.array(roleAssignmentInputSchema).max(20).optional(),
});

export const orgUnitCreateSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Z0-9][A-Z0-9_-]*$/, 'Majuscules, chiffres, - et _ uniquement'),
  name: z.string().trim().min(2).max(160),
  type: z.enum(ORG_UNIT_TYPES),
  parentId: uuid.nullable().optional(),
});

export const orgUnitUpdateSchema = z.strictObject({
  name: z.string().trim().min(2).max(160).optional(),
  type: z.enum(ORG_UNIT_TYPES).optional(),
  parentId: uuid.nullable().optional(),
  isActive: z.boolean().optional(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type OrgUnitCreateInput = z.infer<typeof orgUnitCreateSchema>;
export type OrgUnitUpdateInput = z.infer<typeof orgUnitUpdateSchema>;
export type RoleAssignmentInput = z.infer<typeof roleAssignmentInputSchema>;
