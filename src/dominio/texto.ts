// Normalizacao e similaridade de texto.
//
// Precisa reproduzir o que o Postgres faz no schema:
//   - lower(unaccent(texto))                        -> normalizar()
//   - similarity(a, b) da extensao pg_trgm          -> similaridade()
//
// Assim o RepositorioLocal devolve exatamente os mesmos resultados que a RPC
// buscar_medicamento devolveria no Supabase. Ver db/01_schema_supabase.sql.

/** lower + remocao de acentos (equivalente a lower(unaccent(...))). */
export function normalizar(texto: string): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // marcas de acento combinantes
    .toLowerCase()
    .trim();
}

/**
 * Trigramas no estilo pg_trgm: cada palavra (sequencia alfanumerica) recebe
 * dois espacos a esquerda e um a direita, e e fatiada em janelas de 3 chars.
 * O conjunto e deduplicado.
 */
export function trigramas(texto: string): Set<string> {
  const set = new Set<string>();
  const palavras = normalizar(texto).split(/[^a-z0-9]+/).filter(Boolean);
  for (const p of palavras) {
    const s = '  ' + p + ' ';
    for (let i = 0; i + 3 <= s.length; i++) set.add(s.slice(i, i + 3));
  }
  return set;
}

/** similarity(a, b) do pg_trgm: |interseccao| / |uniao| dos trigramas. */
export function similaridade(a: string, b: string): number {
  const ta = trigramas(a);
  const tb = trigramas(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const uniao = ta.size + tb.size - inter;
  return uniao === 0 ? 0 : inter / uniao;
}
