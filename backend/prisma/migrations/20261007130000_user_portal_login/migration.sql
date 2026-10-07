-- Login curto do portal, separado do e-mail de administradores.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "login" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_login_key" ON "User"("login");

-- Contas já gravadas com o usuário no e-mail (sem @) passam a ter login preenchido.
UPDATE "User"
SET "login" = lower("email")
WHERE "login" IS NULL
  AND "email" NOT LIKE '%@%';
