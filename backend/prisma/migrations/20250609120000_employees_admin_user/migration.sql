-- AlterEnum: adiciona EMPLOYEES_ADMIN e cria usuário licençasadmin
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'EMPLOYEES_ADMIN';
