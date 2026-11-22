-- Conta de teste: usuário que pode ver o sistema como qualquer perfil
-- (só quando CONTAS_DE_TESTE=1 no servidor)
ALTER TABLE "Usuario" ADD COLUMN "contaTeste" BOOLEAN NOT NULL DEFAULT false;
