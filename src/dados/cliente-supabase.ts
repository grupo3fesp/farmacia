// Criacao do cliente Supabase, compartilhada pelo repositorio e pelo
// armazenamento de sessao. O SDK entra por import dinamico: o modo local roda
// sem ele instalado.

// O query builder do supabase-js e encadeavel e thenable; uma tipagem completa
// aqui nao agrega. Usamos uma forma permissiva.
export type QueryBuilder = any;

export type ClienteSupabase = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  from: (tabela: string) => QueryBuilder;
};

export async function criarClienteSupabase(url: string, key: string): Promise<ClienteSupabase> {
  let mod: any;
  try {
    mod = await import('@supabase/supabase-js');
  } catch {
    throw new Error(
      "Pacote '@supabase/supabase-js' nao instalado. Rode `npm install` antes de usar o modo Supabase.",
    );
  }
  return mod.createClient(url, key, { auth: { persistSession: false } }) as ClienteSupabase;
}
