import { z } from "zod";

const userRoleSchema = z.enum(["super_admin", "em", "editor", "reviewer"]);

const squadIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_-]{1,64}$/, "Invalid squad id");

const emailSchema = z.string().trim().toLowerCase().email().max(320);

const squadSchema = z.object({
  id: squadIdSchema,
  name: z.string().trim().min(1).max(120),
  emEmail: z.union([emailSchema, z.literal("")]),
  pmEmails: z.array(emailSchema).max(20).default([]),
  hidden: z.boolean().optional(),
});

const userAccountSchema = z.object({
  email: emailSchema,
  role: userRoleSchema,
  squadId: z.union([squadIdSchema, z.null()]),
});

export const accessRegistrySchema = z.object({
  squads: z.array(squadSchema).min(1).max(100),
  users: z.array(userAccountSchema).max(2000),
  squadAccounts: z.array(userAccountSchema).max(2000),
});

/** User Management PUT: access registry (squad PM emails + users; PM roster people still live on Resources). */
export const userManagementWriteSchema = accessRegistrySchema;

export type AccessRegistryInput = z.infer<typeof accessRegistrySchema>;
export type UserManagementWriteInput = z.infer<typeof userManagementWriteSchema>;

/** Validate User Management PUT body (squads + users + squadAccounts). */
export const parseUserManagementWriteBody = (body: unknown): UserManagementWriteInput =>
  userManagementWriteSchema.parse(body);
