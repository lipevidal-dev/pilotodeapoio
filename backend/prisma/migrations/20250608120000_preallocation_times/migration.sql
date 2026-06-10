-- Horário opcional para cadastros operacionais (simulador com janela real).
ALTER TABLE "PreAllocation" ADD COLUMN "start_time" TEXT;
ALTER TABLE "PreAllocation" ADD COLUMN "end_time" TEXT;
