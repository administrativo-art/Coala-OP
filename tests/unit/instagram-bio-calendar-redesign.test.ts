import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("Programação do Instagram: Calendário e Link na bio no guia de design", () => {
  const calendar = read("src/features/instagram-scheduler/calendar-view.tsx");
  const bioSource = read("src/components/settings/public-bio-settings.tsx");
  // A prévia do site público (BioPreview) reproduz as cores da página real; só o editor segue os tokens.
  const bioEditor = bioSource.slice(bioSource.indexOf("export function PublicBioSettings"));

  it("o calendário usa os componentes do guia e nenhuma cor solta", () => {
    assert.match(calendar, /PulseHero/);
    assert.match(calendar, /HeroChip/);
    assert.match(calendar, /Segmented/);
    assert.doesNotMatch(calendar, /#[0-9a-fA-F]{3,8}\b/);
    assert.doesNotMatch(calendar, /\b(alert|confirm)\(/);
  });

  it("o calendário preserva reagendar por arraste e por data e a criação em cada dia", () => {
    assert.match(calendar, /onDragStart/);
    assert.match(calendar, /onDrop/);
    assert.match(calendar, /Alterar data/);
    assert.match(calendar, /Planejar publicação em/);
    assert.match(calendar, /if \(day < today\) return/);
  });

  it("o editor da bio usa o guia, mensagens fixas e nenhum diálogo nativo", () => {
    assert.match(bioEditor, /PulseHero/);
    assert.match(bioEditor, /CadastrosTabs/);
    // O QR Code é gerado com cores em JS; nas classes não pode haver hex.
    assert.doesNotMatch(bioEditor, /className=\{?"[^"]*#[0-9a-fA-F]{3,8}/);
    assert.doesNotMatch(bioEditor, /<select\b/);
    assert.doesNotMatch(bioEditor, /\b(alert|confirm)\(/);
    assert.doesNotMatch(bioEditor, /\b(?:text|bg|border)-(?:red|green|amber|blue|slate|zinc)-\d{2,3}\b/);
  });

  it("o detalhe da publicação usa o guia fora da prévia do aparelho e confirma o cancelamento inline", () => {
    const editor = read("src/features/instagram-scheduler/schedule-post-editor.tsx");
    const chrome = editor.slice(0, editor.indexOf('rounded-[34px]'));
    assert.doesNotMatch(chrome, /#[0-9a-fA-F]{3,8}\b/);
    assert.match(chrome, /InlineConfirm/);
    assert.match(editor, /onUpdate\(item\.id/);
    assert.match(editor, /onCancel\(item\.id\)/);
    assert.doesNotMatch(read("src/features/instagram-scheduler/media-format-info.tsx"), /#[0-9a-fA-F]{3,8}\b/);
  });

  it("o editor da bio mantém salvar rascunho e publicar com validação", () => {
    assert.match(bioEditor, /submit\("save"\)/);
    assert.match(bioEditor, /submit\("publish"\)/);
    assert.match(bioSource, /validateBioForPublish/);
    assert.match(bioSource, /expectedRevision: revision/);
  });

  it("grade do feed, biblioteca de mídia e relatórios usam o guia, sem cores soltas nem diálogos nativos", () => {
    for (const file of [
      "src/features/instagram-scheduler/feed-grid-view.tsx",
      "src/features/instagram-scheduler/media-library-view.tsx",
      "src/features/instagram-scheduler/media-folder-dialogs.tsx",
      "src/features/instagram-scheduler/insights-view.tsx",
      "src/features/instagram-scheduler/format-tone.ts",
    ]) {
      const source = read(file);
      assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/, file);
      assert.doesNotMatch(source, /\b(alert|confirm)\(/, file);
    }
    assert.match(read("src/features/instagram-scheduler/feed-grid-view.tsx"), /PulseHero/);
    assert.match(read("src/features/instagram-scheduler/insights-view.tsx"), /PulseHero/);
  });

  it("a biblioteca confirma a exclusão da pasta inline, seleciona em massa e usa painel lateral nos nomes e destinos", () => {
    const library = read("src/features/instagram-scheduler/media-library-view.tsx");
    assert.match(library, /InlineConfirm/);
    assert.match(library, /BulkBar/);
    assert.match(library, /onDeleteFolder\(currentFolder\.id\)/);
    assert.match(library, /onMoveMedia\(/);
    assert.doesNotMatch(library, /DeleteFolderDialog/);
    assert.match(read("src/features/instagram-scheduler/media-folder-dialogs.tsx"), /SidePanel/);
  });

  it("o QR Code da bio aparece na aba QR Codes das Configurações com a mesma URL do Link na bio", () => {
    const qr = read("src/components/catalogo/catalogo-qr-panel.tsx");
    assert.match(qr, /BIO_SITE_URL/);
    assert.match(qr, /Link na bio/);
    assert.match(read("src/lib/public-bio.ts"), /export const BIO_SITE_URL/);
    assert.match(bioSource, /BIO_SITE_URL/);
  });

  it("posts e aprovações usam o guia e preservam a confirmação exata das ações autorizadas", () => {
    const posts = read("src/features/instagram-posts/editorial-posts-view.tsx");
    assert.doesNotMatch(posts, /#[0-9a-fA-F]{3,8}\b/);
    assert.match(posts, /PulseHero/);
    assert.match(posts, /SidePanel/);
    for (const pattern of ["APPROVE-CONTENT:", "APPROVE-PUBLICATION:", "PUBLISH:", "CANCEL:", "SCHEDULE:"]) {
      assert.ok(posts.includes(pattern), pattern);
    }
    assert.match(posts, /confirmation !== expected/);
    assert.match(posts, /statement\.trim\(\)\.length < 8/);
  });

  it("a barra lateral é escura, fica recolhida e expande ao passar o cursor sem empurrar a tela, e respeita movimento reduzido", () => {
    const sidebar = read("src/features/instagram-scheduler/workspace-sidebar.tsx");
    assert.doesNotMatch(sidebar, /#[0-9a-fA-F]{3,8}\b/);
    assert.match(sidebar, /onMouseEnter=\{openRail\}/);
    assert.match(sidebar, /lg:w-\[76px\]/);
    assert.match(sidebar, /motion-reduce:/);
    assert.doesNotMatch(sidebar, /Ir para|CommandDialog/);
    assert.match(sidebar, /aria-expanded/);
  });

  it("o cabeçalho vira uma faixa fina ao rolar sem mudar a altura da página, e a barra só fica aberta por foco de teclado", () => {
    const hero = read("src/features/instagram-scheduler/hero-panel.tsx");
    assert.match(hero, /IntersectionObserver/);
    assert.match(hero, /sticky top-3/);
    assert.match(hero, /capture: true/);
    assert.match(hero, /window\.scrollY/);
    assert.match(hero, /motion-reduce:transition-none/);
    const sidebar = read("src/features/instagram-scheduler/workspace-sidebar.tsx");
    assert.match(sidebar, /:focus-visible/);
  });

  it("a lista de posts mostra cartões detalhados com celular simulado, etapas e prévia grande", () => {
    const posts = read("src/features/instagram-posts/editorial-posts-view.tsx");
    assert.match(posts, /PostPhoneThumb/);
    assert.match(posts, /PostPhonePreview/);
    assert.match(posts, /StageTrack/);
    assert.match(posts, /PostDrawer/);
    assert.match(posts, /Concluir planejamento/);
    assert.match(posts, /Checklist/);
    assert.match(posts, /Próximo ›/);
    assert.match(posts, /className="w-\[1040px\]"/);
    assert.doesNotMatch(posts, /#[0-9a-fA-F]{3,8}\b/);
    const phone = read("src/features/instagram-posts/post-phone-preview.tsx");
    for (const screen of ["FeedScreen", "StoryScreen", "ReelScreen"]) assert.match(phone, new RegExp(screen));
    assert.match(phone, /Falta enviar a arte/);
  });

  it("o Coala One usa a mesma barra flutuante, recolhida e com a marca compartilhada", () => {
    const system = read("src/components/sidebar.tsx");
    assert.match(system, /SystemBrand/);
    assert.match(system, /accent="One"/);
    assert.match(system, /openRail/);
    assert.match(system, /motion-reduce:/);
    assert.doesNotMatch(system, /#[0-9a-fA-F]{3,8}\b/);
    assert.match(read("src/app/dashboard/layout.tsx"), /lg:pl-\[88px\]/);
    assert.match(read("src/features/instagram-scheduler/workspace-sidebar.tsx"), /accent="Pulse"/);
    assert.match(read("src/components/patterns/system-brand.tsx"), /coala-shimmer-word/);
  });

  it("a documentação do design registra a barra lateral e o cabeçalho que encolhe", () => {
    assert.match(read("docs/design/README.md"), /barra-lateral\.md/);
    assert.match(read("docs/design/README.md"), /cabecalho-e-etapas\.md/);
    assert.match(read("docs/design/barra-lateral.md"), /lg:pl-\[88px\]/);
    assert.match(read("docs/design/cabecalho-e-etapas.md"), /faixa fina/);
  });

  it("a barra superior é fina, usa o caminho do menu e as mesmas bordas do conteúdo, sem foto nem câmera", () => {
    const header = read("src/components/header.tsx");
    assert.match(header, /useNavTrail/);
    assert.match(header, /h-11/);
    assert.doesNotMatch(header, /UserProfile|GlobalBarcodeScanner/);
    assert.match(read("src/app/dashboard/layout.tsx"), /gutterClassName/);
    assert.match(read("src/components/sidebar.tsx"), /UserProfile variant="card"/);
    assert.match(read("src/components/sidebar.tsx"), /setTrail/);
  });

  it("o controle de estoque não tem botão flutuante e mantém as ações no menu Ações", () => {
    const page = read("src/app/dashboard/inventory-control/page.tsx");
    assert.doesNotMatch(page, /RadialMenu/);
    for (const prop of ["onOpenWriteDown", "onOpenTransfer", "onOpenLabels", "onOpenHistory", "onOpenConsumption"]) {
      assert.match(page, new RegExp(prop));
    }
    const control = read("src/components/expiry-control.tsx");
    for (const label of ["Realizar baixa", "Realizar transferência", "Configurar etiquetas"]) assert.ok(control.includes(label), label);
  });

  it("a rota de Gestão de estoque só redireciona e o menu lateral a trata como grupo", () => {
    assert.match(read("src/app/dashboard/stock/page.tsx"), /router\.replace\(destination\)/);
    assert.match(read("src/components/sidebar.tsx"), /href: "__group:stock"/);
  });
});
