from __future__ import annotations

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from xml.etree import ElementTree as etree


ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / "docs" / "modelos-documentos" / "admissionais"
SOURCE = TEMPLATES / "06-vale-transporte-solicitacao-v2.docx"
WAIVER_SOURCE = TEMPLATES / "06-vale-transporte-renuncia-v2.docx"
W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W_NS}
etree.register_namespace("w", W_NS)
LEGAL_REFERENCE = ", nos termos do artigo 7º do Decreto n˚ 95.247, de 17 de novembro de 1987, "
LIST_DIVIDER = "Em caso de opção pelo benefício, também me comprometo a:"
GENERIC_OPENING = (
    "Eu, {{employee.name}}, portador(a) da CTPS n˚ {{employee.ctps_number}} e série n˚ "
    "{{employee.ctps_series}}, doravante designado(a) como EMPREGADO(A), declaro que "
    "{{transport_voucher_decision_text}} pela utilização do vale-transporte para o deslocamento "
    "residência–trabalho e vice-versa."
)
SUSPENSION_OPENING = (
    "Eu, {{employee.name}}, portador(a) da CTPS n˚ {{employee.ctps_number}} e série n˚ "
    "{{employee.ctps_series}}, doravante designado(a) como EMPREGADO(A), solicito expressamente "
    "a suspensão do benefício de vale-transporte utilizado para o deslocamento "
    "residência–trabalho e vice-versa."
)
REACTIVATION_OPENING = (
    "Eu, {{employee.name}}, portador(a) da CTPS n˚ {{employee.ctps_number}} e série n˚ "
    "{{employee.ctps_series}}, doravante designado(a) como EMPREGADO(A), solicito expressamente "
    "a reativação do benefício de vale-transporte utilizado para o deslocamento "
    "residência–trabalho e vice-versa."
)
CUTOFF_SUSPENSION = (
    "Declaro estar ciente e de acordo com a regra de corte: solicitações realizadas até o dia "
    "{{transport_voucher_cutoff_day}} entram em vigor no primeiro dia do mês seguinte; solicitações "
    "posteriores entram em vigor no primeiro dia do segundo mês seguinte. Para este pedido, a "
    "suspensão entrará em vigor em {{transport_voucher_effective_date}}, será considerada na "
    "competência {{transport_voucher_processing_competence}} e aparecerá no contracheque pago em "
    "{{transport_voucher_payslip_payment_date}}."
)
CUTOFF_REACTIVATION = (
    "Declaro estar ciente e de acordo com a regra de corte: solicitações realizadas até o dia "
    "{{transport_voucher_cutoff_day}} entram em vigor no primeiro dia do mês seguinte; solicitações "
    "posteriores entram em vigor no primeiro dia do segundo mês seguinte. Para este pedido, a "
    "reativação entrará em vigor em {{transport_voucher_effective_date}}, será considerada na "
    "competência {{transport_voucher_processing_competence}} e aparecerá no contracheque pago em "
    "{{transport_voucher_payslip_payment_date}}."
)
INFO_HEADING = "Informações para a concessão do benefício, nos termos do artigo 7º do Decreto n˚ 95.247/87:"
SIMPLIFIED_INFO_HEADING = "Informações para a concessão do benefício:"


def paragraph_text(paragraph: etree.Element) -> str:
    return "".join(node.text or "" for node in paragraph.findall(".//w:t", NS)).strip()


def set_paragraph_text(paragraph: etree.Element, value: str) -> None:
    text_nodes = paragraph.findall(".//w:t", NS)
    if not text_nodes:
        raise RuntimeError("Parágrafo sem nó de texto editável.")
    text_nodes[0].text = value
    for node in text_nodes[1:]:
        node.text = ""


def remove_paragraph(root: etree.Element, paragraph: etree.Element) -> None:
    parent = next((candidate for candidate in root.iter() if paragraph in list(candidate)), None)
    if parent is not None:
        parent.remove(paragraph)


def normalize_common(root: etree.Element) -> None:
    for node in root.findall(".//w:t", NS):
        node.text = (node.text or "").replace("nÚ", "n˚").replace("Vale-Transporte", "vale-transporte")
    openings = [paragraph for paragraph in root.findall(".//w:p", NS) if LEGAL_REFERENCE in paragraph_text(paragraph)]
    if len(openings) != 1:
        raise RuntimeError(f"Esperado um parágrafo com a referência legal inicial; encontrados {len(openings)}.")
    set_paragraph_text(openings[0], paragraph_text(openings[0]).replace(LEGAL_REFERENCE, ", "))
    headings = [paragraph for paragraph in root.findall(".//w:p", NS) if paragraph_text(paragraph) == INFO_HEADING]
    if len(headings) != 1:
        raise RuntimeError(f"Esperado um cabeçalho de concessão; encontrados {len(headings)}.")
    set_paragraph_text(headings[0], SIMPLIFIED_INFO_HEADING)


def remove_list_divider(root: etree.Element) -> None:
    dividers = [paragraph for paragraph in root.findall(".//w:p", NS) if paragraph_text(paragraph) == LIST_DIVIDER]
    if len(dividers) != 1:
        raise RuntimeError(f"Esperado um divisor da lista; encontrados {len(dividers)}.")
    remove_paragraph(root, dividers[0])


def transform(root: etree.Element, kind: str) -> None:
    normalize_common(root)
    paragraphs = root.findall(".//w:p", NS)
    opening = next((paragraph for paragraph in paragraphs if "doravante designado(a)" in paragraph_text(paragraph)), None)
    non_option = next((paragraph for paragraph in paragraphs if paragraph_text(paragraph).startswith("Em caso de não opção")), None)
    if opening is None or non_option is None:
        raise RuntimeError(f"{kind}: estrutura base do documento não encontrada.")

    if kind == "adhesion":
        set_paragraph_text(opening, GENERIC_OPENING)
        remove_list_divider(root)
    elif kind == "suspension":
        title = next(paragraph for paragraph in paragraphs if "transport_voucher_document_title" in paragraph_text(paragraph))
        set_paragraph_text(title, "DECLARAÇÃO DE SUSPENSÃO E NÃO UTILIZAÇÃO DE VALE-TRANSPORTE")
        set_paragraph_text(opening, SUSPENSION_OPENING)
        set_paragraph_text(non_option, CUTOFF_SUSPENSION)
        removing = False
        for paragraph in list(root.findall(".//w:p", NS)):
            text = paragraph_text(paragraph)
            if text == SIMPLIFIED_INFO_HEADING:
                removing = True
            if removing and paragraph is not non_option:
                remove_paragraph(root, paragraph)
            if paragraph is non_option:
                removing = False
    elif kind == "reactivation":
        title = next(paragraph for paragraph in paragraphs if paragraph_text(paragraph) == "SOLICITAÇÃO DE VALE-TRANSPORTE")
        set_paragraph_text(title, "SOLICITAÇÃO DE REATIVAÇÃO DO VALE-TRANSPORTE")
        set_paragraph_text(opening, REACTIVATION_OPENING)
        set_paragraph_text(non_option, CUTOFF_REACTIVATION)
        remove_list_divider(root)
    else:
        raise RuntimeError(f"Tipo desconhecido: {kind}")

    visible = " ".join(paragraph_text(paragraph) for paragraph in root.findall(".//w:p", NS))
    if LEGAL_REFERENCE.strip() in visible or "nÚ" in visible or LIST_DIVIDER in visible:
        raise RuntimeError(f"{kind}: a validação final encontrou texto antigo.")
    if kind != "adhesion" and "{{transport_voucher_cutoff_day}}" not in visible:
        raise RuntimeError(f"{kind}: regra de corte ausente.")


def create_document(source: Path, output_name: str, kind: str) -> Path:
    output = TEMPLATES / output_name
    with ZipFile(source, "r") as source_zip, ZipFile(output, "w", compression=ZIP_DEFLATED) as output_zip:
        for info in source_zip.infolist():
            data = source_zip.read(info.filename)
            if info.filename == "word/document.xml":
                root = etree.fromstring(data)
                transform(root, kind)
                data = etree.tostring(root, xml_declaration=True, encoding="UTF-8")
            elif info.filename.startswith("word/footer") and info.filename.endswith(".xml"):
                root = etree.fromstring(data)
                for node in root.findall(".//w:t", NS):
                    node.text = (node.text or "").replace("nÚ", "n˚").replace("Vale-Transporte", "vale-transporte")
                data = etree.tostring(root, xml_declaration=True, encoding="UTF-8")
            output_zip.writestr(info, data)
    return output


if __name__ == "__main__":
    print(create_document(SOURCE, "06-vale-transporte-solicitacao-v3.docx", "adhesion"))
    print(create_document(WAIVER_SOURCE, "06-vale-transporte-renuncia-v3.docx", "suspension"))
    print(create_document(SOURCE, "06-vale-transporte-reativacao-v1.docx", "reactivation"))
