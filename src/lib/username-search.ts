/** Grafias de prefixo para buscar `username` no Firestore, que só compara texto exato. Máximo de 5 consultas. */
export function usernameSearchVariants(search: string) {
  const trimmed = search.trim();
  const lower = trimmed.toLocaleLowerCase('pt-BR');
  const capitalize = (word: string) => word.charAt(0).toLocaleUpperCase('pt-BR') + word.slice(1);
  return [...new Set([trimmed, lower, capitalize(lower), lower.split(' ').map(capitalize).join(' '), trimmed.toLocaleUpperCase('pt-BR')])]
    .filter(Boolean);
}
