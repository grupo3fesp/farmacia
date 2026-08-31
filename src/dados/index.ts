// Fabrica do repositorio: escolhe a implementacao conforme a configuracao.
// A camada de negocio recebe sempre a interface Repositorio, sem saber qual.

import { config } from '../config.ts';
import type { Repositorio } from './repositorio.ts';
import { RepositorioLocal } from './local.ts';
import { RepositorioSupabase } from './supabase.ts';

export function criarRepositorio(): Repositorio {
  if (config.repositorio === 'supabase') {
    if (!config.supabase.url || !config.supabase.anonKey) {
      throw new Error(
        'REPOSITORIO=supabase exige SUPABASE_URL e SUPABASE_ANON_KEY no .env. ' +
          'Para rodar offline, use REPOSITORIO=local (padrao).',
      );
    }
    return new RepositorioSupabase(config.supabase);
  }
  return new RepositorioLocal();
}

export type { Repositorio } from './repositorio.ts';
