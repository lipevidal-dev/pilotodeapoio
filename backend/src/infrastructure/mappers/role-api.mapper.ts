import type { Role } from "@prisma/client";

export interface RoleApiRecord {
  id: string;
  name: string;
  code: string;
  description: string | null;
  active: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export function roleToApi(row: Role): RoleApiRecord {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    active: row.active,
    displayOrder: row.displayOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
