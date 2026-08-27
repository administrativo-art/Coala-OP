import PizZip from "pizzip";

const WORD_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const STYLE_IDS = [
  "CTCorpo",
  "CTTituloDocumento",
  "CTSecao",
  "CTClausulaN1",
  "CTClausulaN2",
  "CTPreambulo",
  "CTFecho",
  "CTAssinatura",
  "CTCabecalho",
  "CTRodape",
  "CTMarcaPrevia",
  "CTCabecalhoCaractere",
  "CTAssinaturaLinha",
  "CTAssinaturaNome",
  "CTAssinaturaQualificacao",
  "CTReciboNumero",
  "CTReciboEtiqueta",
  "CTReciboTitulo",
  "CTReciboSubtitulo",
  "CTReciboIntroducao",
  "CTReciboSecao",
  "CTReciboRotulo",
  "CTReciboValor",
  "CTReciboTabela",
  "CTReciboValorDireita",
  "CTReciboTotalRotulo",
  "CTReciboTotalValor",
  "CTReciboDeclaracao",
  "CTReciboData",
  "CTReciboDestaque",
  "CTReciboAuxiliar",
] as const;

const STYLES_XML = `
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CTCorpo">
  <w:name w:val="CT Corpo"/><w:basedOn w:val="Normal"/><w:next w:val="CTCorpo"/><w:qFormat/>
  <w:pPr><w:widowControl/><w:spacing w:before="0" w:after="200" w:line="276" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr>
  <w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:eastAsia="Cambria" w:cs="Cambria"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CTTituloDocumento">
  <w:name w:val="CT Título do documento"/><w:basedOn w:val="CTCorpo"/><w:next w:val="CTPreambulo"/><w:qFormat/>
  <w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="0" w:after="360" w:line="276" w:lineRule="auto"/><w:jc w:val="center"/><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="10" w:color="999999"/></w:pBdr></w:pPr>
  <w:rPr><w:b/><w:bCs/><w:caps/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CTSecao">
  <w:name w:val="CT Seção"/><w:basedOn w:val="CTCorpo"/><w:next w:val="CTClausulaN1"/><w:qFormat/>
  <w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="280" w:after="120" w:line="276" w:lineRule="auto"/><w:jc w:val="left"/></w:pPr>
  <w:rPr><w:b/><w:bCs/><w:caps/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CTClausulaN1">
  <w:name w:val="CT Cláusula nível 1"/><w:basedOn w:val="CTCorpo"/><w:next w:val="CTClausulaN1"/><w:qFormat/>
  <w:pPr><w:keepLines/><w:spacing w:before="0" w:after="200" w:line="276" w:lineRule="auto"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="90"/></w:numPr></w:pPr>
</w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CTClausulaN2">
  <w:name w:val="CT Cláusula nível 2"/><w:basedOn w:val="CTCorpo"/><w:next w:val="CTClausulaN2"/><w:qFormat/>
  <w:pPr><w:keepLines/><w:spacing w:before="0" w:after="120" w:line="276" w:lineRule="auto"/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="90"/></w:numPr></w:pPr>
</w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CTPreambulo">
  <w:name w:val="CT Preâmbulo"/><w:basedOn w:val="CTCorpo"/><w:next w:val="CTCorpo"/><w:qFormat/>
  <w:pPr><w:spacing w:before="0" w:after="200" w:line="276" w:lineRule="auto"/></w:pPr>
</w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CTFecho">
  <w:name w:val="CT Fecho"/><w:basedOn w:val="CTCorpo"/><w:next w:val="CTAssinatura"/><w:qFormat/>
  <w:pPr><w:spacing w:before="0" w:after="200" w:line="276" w:lineRule="auto"/></w:pPr>
</w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CTAssinatura">
  <w:name w:val="CT Assinatura"/><w:basedOn w:val="CTCorpo"/><w:next w:val="CTAssinatura"/><w:qFormat/>
  <w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>
  <w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CTCabecalho">
  <w:name w:val="CT Cabeçalho"/><w:basedOn w:val="Normal"/><w:next w:val="CTCabecalho"/><w:qFormat/>
  <w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="right"/></w:pPr>
  <w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:eastAsia="Cambria" w:cs="Cambria"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CTRodape">
  <w:name w:val="CT Rodapé"/><w:basedOn w:val="Normal"/><w:next w:val="CTRodape"/><w:qFormat/>
  <w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="left"/></w:pPr>
  <w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:eastAsia="Cambria" w:cs="Cambria"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CTMarcaPrevia">
  <w:name w:val="CT Marca de prévia"/><w:basedOn w:val="Normal"/><w:next w:val="CTMarcaPrevia"/><w:qFormat/>
  <w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="center"/></w:pPr>
  <w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:eastAsia="Cambria" w:cs="Cambria"/><w:b/><w:bCs/><w:caps/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>
</w:style>
<w:style w:type="character" w:customStyle="1" w:styleId="CTCabecalhoCaractere">
  <w:name w:val="CT Cabeçalho caractere"/><w:basedOn w:val="DefaultParagraphFont"/>
  <w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:eastAsia="Cambria" w:cs="Cambria"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CTAssinaturaLinha">
  <w:name w:val="CT Linha de assinatura"/><w:basedOn w:val="CTAssinatura"/><w:next w:val="CTAssinatura"/>
  <w:pPr><w:keepNext/><w:keepLines/><w:pBdr><w:top w:val="single" w:sz="6" w:space="5" w:color="333333"/></w:pBdr></w:pPr>
</w:style>
<w:style w:type="character" w:customStyle="1" w:styleId="CTAssinaturaNome">
  <w:name w:val="CT Nome da assinatura"/><w:basedOn w:val="DefaultParagraphFont"/>
  <w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:eastAsia="Cambria" w:cs="Cambria"/><w:b/><w:bCs/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>
</w:style>
<w:style w:type="character" w:customStyle="1" w:styleId="CTAssinaturaQualificacao">
  <w:name w:val="CT Qualificação da assinatura"/><w:basedOn w:val="DefaultParagraphFont"/>
  <w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:eastAsia="Cambria" w:cs="Cambria"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CTReciboNumero">
  <w:name w:val="CT Recibo número"/><w:basedOn w:val="CTCorpo"/><w:next w:val="CTReciboEtiqueta"/>
  <w:pPr><w:spacing w:before="0" w:after="80"/><w:jc w:val="right"/></w:pPr>
  <w:rPr><w:color w:val="64748B"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CTReciboEtiqueta">
  <w:name w:val="CT Recibo etiqueta"/><w:basedOn w:val="CTCorpo"/><w:next w:val="CTReciboTitulo"/>
  <w:pPr><w:spacing w:before="0" w:after="220"/><w:jc w:val="right"/></w:pPr>
  <w:rPr><w:b/><w:bCs/><w:caps/><w:color w:val="ED1E79"/><w:sz w:val="18"/><w:szCs w:val="18"/><w:spacing w:val="18"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CTReciboTitulo">
  <w:name w:val="CT Recibo título"/><w:basedOn w:val="CTCorpo"/><w:next w:val="CTReciboSubtitulo"/><w:qFormat/>
  <w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="0" w:after="60"/><w:jc w:val="left"/></w:pPr>
  <w:rPr><w:b/><w:bCs/><w:caps/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CTReciboSubtitulo">
  <w:name w:val="CT Recibo subtítulo"/><w:basedOn w:val="CTCorpo"/><w:next w:val="CTReciboIntroducao"/>
  <w:pPr><w:spacing w:before="0" w:after="120"/><w:jc w:val="left"/></w:pPr>
  <w:rPr><w:color w:val="64748B"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CTReciboIntroducao">
  <w:name w:val="CT Recibo introdução"/><w:basedOn w:val="CTCorpo"/><w:next w:val="CTReciboSecao"/>
  <w:pPr><w:spacing w:before="0" w:after="220"/><w:jc w:val="left"/></w:pPr>
</w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CTReciboSecao">
  <w:name w:val="CT Recibo seção"/><w:basedOn w:val="CTCorpo"/><w:next w:val="CTReciboTabela"/><w:qFormat/>
  <w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="120" w:after="80"/><w:jc w:val="left"/></w:pPr>
  <w:rPr><w:b/><w:bCs/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CTReciboRotulo">
  <w:name w:val="CT Recibo rótulo"/><w:basedOn w:val="CTCorpo"/><w:next w:val="CTReciboValor"/>
  <w:pPr><w:spacing w:before="0" w:after="30"/><w:jc w:val="left"/></w:pPr>
  <w:rPr><w:b/><w:bCs/><w:caps/><w:color w:val="8391A7"/><w:sz w:val="16"/><w:szCs w:val="16"/><w:spacing w:val="10"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CTReciboValor">
  <w:name w:val="CT Recibo valor"/><w:basedOn w:val="CTCorpo"/><w:next w:val="CTReciboValor"/>
  <w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="left"/></w:pPr>
  <w:rPr><w:b/><w:bCs/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CTReciboTabela">
  <w:name w:val="CT Recibo tabela"/><w:basedOn w:val="CTCorpo"/><w:next w:val="CTReciboTabela"/>
  <w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="left"/></w:pPr>
  <w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CTReciboValorDireita">
  <w:name w:val="CT Recibo valor à direita"/><w:basedOn w:val="CTReciboTabela"/><w:next w:val="CTReciboValorDireita"/>
  <w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="right"/></w:pPr>
  <w:rPr><w:b/><w:bCs/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CTReciboTotalRotulo">
  <w:name w:val="CT Recibo total rótulo"/><w:basedOn w:val="CTCorpo"/><w:next w:val="CTReciboTotalValor"/>
  <w:pPr><w:spacing w:before="0" w:after="20"/><w:jc w:val="left"/></w:pPr>
  <w:rPr><w:b/><w:bCs/><w:caps/><w:color w:val="ED1E79"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CTReciboTotalValor">
  <w:name w:val="CT Recibo total valor"/><w:basedOn w:val="CTCorpo"/><w:next w:val="CTReciboTotalValor"/>
  <w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="right"/></w:pPr>
  <w:rPr><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CTReciboDeclaracao">
  <w:name w:val="CT Recibo declaração"/><w:basedOn w:val="CTCorpo"/><w:next w:val="CTReciboData"/>
  <w:pPr><w:keepLines/><w:spacing w:before="0" w:after="0" w:line="276" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr>
</w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CTReciboData">
  <w:name w:val="CT Recibo data"/><w:basedOn w:val="CTCorpo"/><w:next w:val="CTAssinatura"/>
  <w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="180" w:after="260"/><w:jc w:val="right"/></w:pPr>
</w:style>
<w:style w:type="character" w:customStyle="1" w:styleId="CTReciboDestaque">
  <w:name w:val="CT Recibo destaque"/><w:basedOn w:val="DefaultParagraphFont"/>
  <w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:eastAsia="Cambria" w:cs="Cambria"/><w:b/><w:bCs/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
</w:style>
<w:style w:type="character" w:customStyle="1" w:styleId="CTReciboAuxiliar">
  <w:name w:val="CT Recibo auxiliar"/><w:basedOn w:val="DefaultParagraphFont"/>
  <w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:eastAsia="Cambria" w:cs="Cambria"/><w:color w:val="64748B"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>
</w:style>`.replace(/\n\s*/g, "");

const NUMBERING_XML = `
<w:abstractNum w:abstractNumId="90">
  <w:multiLevelType w:val="multilevel"/>
  <w:lvl w:ilvl="0">
    <w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="CTClausulaN1"/>
    <w:lvlText w:val="%1."/><w:lvlJc w:val="left"/>
    <w:pPr><w:ind w:left="425" w:hanging="425"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:eastAsia="Cambria" w:cs="Cambria"/><w:b/><w:bCs/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
  </w:lvl>
  <w:lvl w:ilvl="1">
    <w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="CTClausulaN2"/>
    <w:lvlText w:val="%1.%2."/><w:lvlJc w:val="left"/>
    <w:pPr><w:ind w:left="992" w:hanging="567"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:eastAsia="Cambria" w:cs="Cambria"/><w:b/><w:bCs/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
  </w:lvl>
</w:abstractNum>
<w:num w:numId="90"><w:abstractNumId w:val="90"/></w:num>`.replace(/\n\s*/g, "");

const HEADER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="${WORD_NS}">
  <w:p><w:pPr><w:pStyle w:val="CTCabecalho"/></w:pPr>
    <w:r><w:rPr><w:rStyle w:val="CTCabecalhoCaractere"/></w:rPr><w:t xml:space="preserve">Página </w:t></w:r>
    <w:r><w:rPr><w:rStyle w:val="CTCabecalhoCaractere"/></w:rPr><w:fldChar w:fldCharType="begin"/><w:instrText xml:space="preserve"> PAGE </w:instrText><w:fldChar w:fldCharType="separate"/><w:t>1</w:t><w:fldChar w:fldCharType="end"/></w:r>
    <w:r><w:rPr><w:rStyle w:val="CTCabecalhoCaractere"/></w:rPr><w:t xml:space="preserve"> de </w:t></w:r>
    <w:r><w:rPr><w:rStyle w:val="CTCabecalhoCaractere"/></w:rPr><w:fldChar w:fldCharType="begin"/><w:instrText xml:space="preserve"> NUMPAGES </w:instrText><w:fldChar w:fldCharType="separate"/><w:t>1</w:t><w:fldChar w:fldCharType="end"/></w:r>
  </w:p>
</w:hdr>`.replace(/\n\s*/g, "");

const FOOTER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="${WORD_NS}"><w:p><w:pPr><w:pStyle w:val="CTRodape"/></w:pPr></w:p></w:ftr>`;

function removeStyle(xml: string, styleId: string) {
  return xml.replace(
    new RegExp(
      `<w:style\\b(?=[^>]*\\bw:styleId="${styleId}")[\\s\\S]*?<\\/w:style>`,
      "g",
    ),
    "",
  );
}

function ensureSettings(xml: string) {
  const names = [
    "autoHyphenation",
    "hyphenationZone",
    "doNotHyphenateCaps",
    "updateFields",
  ];
  let output = xml;
  for (const name of names) {
    output = output.replace(new RegExp(`<w:${name}\\b[^>]*/>`, "g"), "");
  }
  return output.replace(
    "</w:settings>",
    '<w:autoHyphenation w:val="true"/><w:hyphenationZone w:val="357"/><w:doNotHyphenateCaps w:val="true"/><w:updateFields w:val="true"/></w:settings>',
  );
}

function ensureStyles(xml: string) {
  let output = xml;
  for (const styleId of STYLE_IDS) output = removeStyle(output, styleId);
  return output.replace("</w:styles>", `${STYLES_XML}</w:styles>`);
}

function ensureNumbering(xml: string) {
  return xml
    .replace(
      /<w:abstractNum\b(?=[^>]*\bw:abstractNumId="90")[\s\S]*?<\/w:abstractNum>/g,
      "",
    )
    .replace(/<w:num\b(?=[^>]*\bw:numId="90")[\s\S]*?<\/w:num>/g, "")
    .replace("</w:numbering>", `${NUMBERING_XML}</w:numbering>`);
}

function ensurePageGeometry(xml: string) {
  let output = xml.replace(
    /<w:pgSz\b[^>]*\/>/g,
    '<w:pgSz w:w="11906" w:h="16838"/>',
  );
  output = output.replace(
    /<w:pgMar\b[^>]*\/>/g,
    '<w:pgMar w:top="1417" w:right="1701" w:bottom="1417" w:left="1701" w:header="709" w:footer="709" w:gutter="0"/>',
  );
  return output;
}

function requirePart(zip: PizZip, name: string) {
  const part = zip.file(name);
  if (!part) throw new Error(`Parte OOXML ausente: ${name}.`);
  return part.asText();
}

function relationshipTarget(
  relationships: string,
  kind: "header" | "footer",
) {
  return relationships.match(
    new RegExp(
      `<Relationship\\b(?=[^>]*Type="[^"]*/${kind}")(?=[^>]*Target="([^"]+)")[^>]*/>`,
    ),
  )?.[1] ?? null;
}

function ensurePackageParts(zip: PizZip) {
  let relationships = requirePart(zip, "word/_rels/document.xml.rels");
  let contentTypes = requirePart(zip, "[Content_Types].xml");
  let documentXml = requirePart(zip, "word/document.xml");

  const ensureRelationship = (
    kind: "header" | "footer" | "numbering",
    target: string,
    id: string,
  ) => {
    if (
      !new RegExp(
        `Type="http://schemas\\.openxmlformats\\.org/officeDocument/2006/relationships/${kind}"`,
      ).test(relationships)
    ) {
      relationships = relationships.replace(
        "</Relationships>",
        `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}" Target="${target}"/></Relationships>`,
      );
    }
  };
  ensureRelationship("numbering", "numbering.xml", "rIdCtNumbering");

  const existingHeader = relationshipTarget(relationships, "header");
  const existingFooter = relationshipTarget(relationships, "footer");
  ensureRelationship("header", "header1.xml", "rIdCtHeader");
  ensureRelationship("footer", "footer1.xml", "rIdCtFooter");
  const headerTarget = existingHeader ?? "header1.xml";
  const footerTarget = existingFooter ?? "footer1.xml";
  const headerId =
    relationships.match(
      new RegExp(
        `<Relationship\\b(?=[^>]*Type="[^"]*/header")(?=[^>]*Target="${headerTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}")(?=[^>]*Id="([^"]+)")[^>]*/>`,
      ),
    )?.[1] ?? "rIdCtHeader";
  const footerId =
    relationships.match(
      new RegExp(
        `<Relationship\\b(?=[^>]*Type="[^"]*/footer")(?=[^>]*Target="${footerTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}")(?=[^>]*Id="([^"]+)")[^>]*/>`,
      ),
    )?.[1] ?? "rIdCtFooter";

  const ensureOverride = (partName: string, contentType: string) => {
    if (!contentTypes.includes(`PartName="${partName}"`)) {
      contentTypes = contentTypes.replace(
        "</Types>",
        `<Override PartName="${partName}" ContentType="${contentType}"/></Types>`,
      );
    }
  };
  ensureOverride(
    "/word/numbering.xml",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml",
  );
  ensureOverride(
    `/word/${headerTarget}`,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml",
  );
  ensureOverride(
    `/word/${footerTarget}`,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml",
  );

  documentXml = documentXml.replace(
    /<w:sectPr\b([^>]*)>([\s\S]*?)<\/w:sectPr>/g,
    (sectionXml, attributes: string, content: string) => {
      let references = "";
      if (!sectionXml.includes("w:headerReference")) {
        references += `<w:headerReference w:type="default" r:id="${headerId}"/>`;
      }
      if (!sectionXml.includes("w:footerReference")) {
        references += `<w:footerReference w:type="default" r:id="${footerId}"/>`;
      }
      return `<w:sectPr${attributes}>${references}${content}</w:sectPr>`;
    },
  );

  zip.file("word/_rels/document.xml.rels", relationships);
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("word/document.xml", documentXml);
  zip.file(`word/${headerTarget}`, HEADER_XML);
  zip.file(`word/${footerTarget}`, FOOTER_XML);
  if (!zip.file("word/numbering.xml")) {
    zip.file(
      "word/numbering.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${WORD_NS}"/>`,
    );
  }
}

export function applyCtDocumentStandard(input: Buffer) {
  const zip = new PizZip(input);
  ensurePackageParts(zip);
  zip.file("word/styles.xml", ensureStyles(requirePart(zip, "word/styles.xml")));
  zip.file(
    "word/numbering.xml",
    ensureNumbering(requirePart(zip, "word/numbering.xml")),
  );
  zip.file(
    "word/settings.xml",
    ensureSettings(requirePart(zip, "word/settings.xml")),
  );
  zip.file(
    "word/document.xml",
    ensurePageGeometry(requirePart(zip, "word/document.xml")),
  );
  return Buffer.from(
    zip.generate({ type: "nodebuffer", compression: "DEFLATE" }),
  );
}

export function createCtBaseTemplate(input: Buffer) {
  const standardized = applyCtDocumentStandard(input);
  const zip = new PizZip(standardized);
  const documentXml = requirePart(zip, "word/document.xml");
  const documentOpen = documentXml.match(/^([\s\S]*?<w:body>)/)?.[1];
  const section = documentXml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)?.[0];
  if (!documentOpen || !section) {
    throw new Error("Não foi possível preservar a seção do DOCX de origem.");
  }
  zip.file(
    "word/document.xml",
    `${documentOpen}<w:p><w:pPr><w:pStyle w:val="CTCorpo"/></w:pPr></w:p>${section}</w:body></w:document>`,
  );

  const contentTypes = requirePart(zip, "[Content_Types].xml").replace(
    /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document\.main\+xml/g,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml",
  );
  zip.file("[Content_Types].xml", contentTypes);
  return Buffer.from(
    zip.generate({ type: "nodebuffer", compression: "DEFLATE" }),
  );
}

export const CT_DOCUMENT_STYLE_IDS = STYLE_IDS;

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function paragraphText(paragraph: string) {
  return [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((match) => match[1])
    .join("")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function styledParagraph(params: {
  styleId: string;
  text: string;
  numPr?: string | null;
  characterStyle?: string | null;
}) {
  const runProperties = params.characterStyle
    ? `<w:rPr><w:rStyle w:val="${params.characterStyle}"/></w:rPr>`
    : "";
  return (
    `<w:p><w:pPr><w:pStyle w:val="${params.styleId}"/>${params.numPr ?? ""}</w:pPr>` +
    (params.text
      ? `<w:r>${runProperties}<w:t xml:space="preserve">${escapeXml(params.text)}</w:t></w:r>`
      : "") +
    "</w:p>"
  );
}

export function migrateCtDocumentParagraphStyles(
  input: Buffer,
  options: {
    textReplacements?: Array<{ search: string; replacement: string }>;
  } = {},
) {
  const standardized = applyCtDocumentStandard(input);
  const zip = new PizZip(standardized);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("O modelo não contém word/document.xml.");
  const source = file.asText();
  const paragraphs = [
    ...source.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g),
  ].map((match) => match[0]);
  const texts = paragraphs.map(paragraphText);
  const firstContent = texts.findIndex((text) => text.trim());
  const firstClause = texts.findIndex((text) =>
    /^\s*\d+(?:\.\d+)?\s*(?:[.\-–—])\s*/.test(text),
  );
  const signatureTokens = new Set([
    "{{employee.name}}",
    "{{integration.employer_name}}",
  ]);
  const signatureQualifications = new Set([
    "EMPREGADO(A)",
    "EMPREGADORA",
    "TITULAR",
    "CONTROLADORA",
    "EMPREGADO(A) / TITULAR",
    "EMPREGADORA / CONTROLADORA",
  ]);
  let paragraphIndex = 0;
  const documentXml = source.replace(
    /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g,
    (paragraph) => {
      const index = paragraphIndex++;
      let text = paragraphText(paragraph)
        .replace(/\t+/g, " ")
        .replace(/ {2,}/g, " ")
        .trim();
      for (const replacement of options.textReplacements ?? []) {
        text = text.replaceAll(replacement.search, replacement.replacement);
      }
      const typedClause = text.match(
        /^\d+(?:\.\d+)?\s*(?:[.\-–—])\s*/,
      );
      const isTitle = index === firstContent;
      const isSignatureName = signatureTokens.has(text);
      const isSignatureQualification = signatureQualifications.has(text);
      const isClosing =
        /^(?:E,?\s+por estarem|Por estarem|São Luís\/MA,)/iu.test(text);
      const isSection =
        !typedClause &&
        text.length >= 4 &&
        text.length <= 120 &&
        text === text.toLocaleUpperCase("pt-BR") &&
        /[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(text);
      const originalNumPr =
        paragraph.match(/<w:numPr\b[\s\S]*?<\/w:numPr>/)?.[0] ?? null;

      if (typedClause) {
        text = text.slice(typedClause[0].length).trim();
      }
      text = text.replace(
        /^Parágrafo\s+Único\s*(?:[—–-])?\s*/iu,
        "",
      );

      if (isTitle) {
        return styledParagraph({
          styleId: "CTTituloDocumento",
          text,
        });
      }
      if (typedClause) {
        return styledParagraph({
          styleId: "CTClausulaN1",
          text,
        });
      }
      if (isSignatureName) {
        return styledParagraph({
          styleId: "CTAssinaturaLinha",
          text,
          characterStyle: "CTAssinaturaNome",
        });
      }
      if (isSignatureQualification) {
        return styledParagraph({
          styleId: "CTAssinatura",
          text,
          characterStyle: "CTAssinaturaQualificacao",
        });
      }
      if (isClosing) {
        return styledParagraph({ styleId: "CTFecho", text });
      }
      if (isSection) {
        return styledParagraph({ styleId: "CTSecao", text });
      }
      if (index > firstContent && (firstClause < 0 || index < firstClause)) {
        return styledParagraph({ styleId: "CTPreambulo", text });
      }
      return styledParagraph({
        styleId: "CTCorpo",
        text,
        numPr: originalNumPr,
      });
    },
  );
  zip.file("word/document.xml", documentXml);
  return Buffer.from(
    zip.generate({ type: "nodebuffer", compression: "DEFLATE" }),
  );
}
