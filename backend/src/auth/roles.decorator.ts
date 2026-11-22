import { SetMetadata } from '@nestjs/common';
import { Perfil } from '@prisma/client';

export const ROLES_KEY = 'perfis';
// Perfis que podem chamar a rota. O ADMINISTRADOR passa sempre; o AUDITOR
// passa em qualquer leitura (GET) e em nenhuma escrita.
export const Perfis = (...perfis: Perfil[]) => SetMetadata(ROLES_KEY, perfis);
