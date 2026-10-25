export type RepPSourceScope = {
  schemaVersion: 1;
  programName: string;
  archiveSlug: string;
  description: string;
  includeFiles: string[];
  includePrefixes: string[];
  excludePrefixes?: string[];
};

const normalizedPath = (value: string) => value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');

const validateScope = (scope: RepPSourceScope) => {
  if (scope.schemaVersion !== 1) throw new Error('Versão desconhecida do escopo do pacote INPI.');
  if (!scope.programName.trim() || !scope.archiveSlug.match(/^[A-Za-z0-9-]+$/)) {
    throw new Error('Nome ou slug inválido no escopo do pacote INPI.');
  }
  if (!scope.includeFiles.length || !scope.includePrefixes.length) {
    throw new Error('O escopo do pacote INPI precisa declarar arquivos e diretórios.');
  }
  const entries = [...scope.includeFiles, ...scope.includePrefixes, ...(scope.excludePrefixes ?? [])]
    .map(normalizedPath);
  const invalid = entries.filter((entry) => !entry || entry.startsWith('/') || entry.includes('..'));
  if (invalid.length) throw new Error(`Caminho inválido no escopo: ${invalid.join(', ')}`);
};

export const selectRepPSourceFiles = (availableFiles: string[], scope: RepPSourceScope) => {
  validateScope(scope);
  const allFiles = [...new Set(availableFiles.map(normalizedPath).filter(Boolean))].sort();
  const available = new Set(allFiles);
  const includeFiles = scope.includeFiles.map(normalizedPath);
  const includePrefixes = scope.includePrefixes.map(normalizedPath);
  const excludePrefixes = (scope.excludePrefixes ?? []).map(normalizedPath);

  const missingFiles = includeFiles.filter((file) => !available.has(file));
  if (missingFiles.length) throw new Error(`Arquivos obrigatórios ausentes: ${missingFiles.join(', ')}`);
  const emptyPrefixes = includePrefixes.filter((prefix) =>
    !allFiles.some((file) => file === prefix || file.startsWith(`${prefix}/`)));
  if (emptyPrefixes.length) throw new Error(`Diretórios obrigatórios vazios/ausentes: ${emptyPrefixes.join(', ')}`);

  const selected = allFiles.filter((file) =>
    includeFiles.includes(file)
    || includePrefixes.some((prefix) => file === prefix || file.startsWith(`${prefix}/`)))
    .filter((file) => !excludePrefixes.some((prefix) => file === prefix || file.startsWith(`${prefix}/`)));

  const forbidden = selected.filter((name) =>
    /(^|\/)(\.env(?:\.|$)|google-services\.json$)|\.(pfx|p12|pem|key|jks|keystore)$/i.test(name)
    || name.includes('/node_modules/')
    || name.startsWith('node_modules/'));
  if (forbidden.length) throw new Error(`O pacote contém arquivo proibido: ${forbidden.join(', ')}`);
  if (!selected.length) throw new Error('O escopo não selecionou nenhum arquivo.');
  return selected;
};
