from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import xml.etree.ElementTree as ET


SOURCE = Path("scratch/export_payment_plan/final/Plano_completo_vinculacao_pagamentos.docx")
TARGET = Path("scratch/export_payment_plan/final/Plano_completo_vinculacao_pagamentos_final.docx")

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W = f"{{{W_NS}}}"
ET.register_namespace("w", W_NS)


with ZipFile(SOURCE, "r") as source_zip:
    entries = {name: source_zip.read(name) for name in source_zip.namelist()}

root = ET.fromstring(entries["word/document.xml"])
for section in root.findall(f".//{W}sectPr"):
    page_size = section.find(f"{W}pgSz")
    if page_size is None:
        page_size = ET.SubElement(section, f"{W}pgSz")
    page_size.set(f"{W}w", "12240")
    page_size.set(f"{W}h", "15840")
    page_size.attrib.pop(f"{W}orient", None)

    margins = section.find(f"{W}pgMar")
    if margins is None:
        margins = ET.SubElement(section, f"{W}pgMar")
    margins.set(f"{W}top", "1440")
    margins.set(f"{W}right", "1440")
    margins.set(f"{W}bottom", "1440")
    margins.set(f"{W}left", "1440")
    margins.set(f"{W}header", "708")
    margins.set(f"{W}footer", "708")
    margins.set(f"{W}gutter", "0")

numbering_root = ET.fromstring(entries["word/numbering.xml"])
decimal_abstract_ids = set()
for abstract_numbering in numbering_root.findall(f"{W}abstractNum"):
    abstract_id = abstract_numbering.get(f"{W}abstractNumId")
    level = abstract_numbering.find(f"{W}lvl[@{W}ilvl='0']")
    if level is None:
        continue
    number_format = level.find(f"{W}numFmt")
    if number_format is None or number_format.get(f"{W}val") != "decimal":
        continue
    decimal_abstract_ids.add(abstract_id)
    suffix = level.find(f"{W}suff")
    if suffix is None:
        suffix = ET.SubElement(level, f"{W}suff")
    suffix.set(f"{W}val", "tab")
    paragraph_properties = level.find(f"{W}pPr")
    if paragraph_properties is None:
        paragraph_properties = ET.SubElement(level, f"{W}pPr")
    tabs = paragraph_properties.find(f"{W}tabs")
    if tabs is None:
        tabs = ET.SubElement(paragraph_properties, f"{W}tabs")
    tab = tabs.find(f"{W}tab")
    if tab is None:
        tab = ET.SubElement(tabs, f"{W}tab")
    tab.set(f"{W}val", "num")
    tab.set(f"{W}pos", "720")
    indent = paragraph_properties.find(f"{W}ind")
    if indent is None:
        indent = ET.SubElement(paragraph_properties, f"{W}ind")
    indent.set(f"{W}start", "720")
    indent.set(f"{W}hanging", "420")

decimal_number_ids = set()
for numbering_instance in numbering_root.findall(f"{W}num"):
    abstract_reference = numbering_instance.find(f"{W}abstractNumId")
    if abstract_reference is None:
        continue
    if abstract_reference.get(f"{W}val") in decimal_abstract_ids:
        decimal_number_ids.add(numbering_instance.get(f"{W}numId"))

XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"
for paragraph in root.findall(f".//{W}p"):
    number_id = paragraph.find(f"{W}pPr/{W}numPr/{W}numId")
    if number_id is None or number_id.get(f"{W}val") not in decimal_number_ids:
        continue
    first_text = paragraph.find(f".//{W}t")
    if first_text is None or (first_text.text or "").startswith("\u00a0"):
        continue
    first_text.text = "\u00a0" + (first_text.text or "")
    first_text.set(XML_SPACE, "preserve")

entries["word/document.xml"] = ET.tostring(root, encoding="utf-8", xml_declaration=True)
entries["word/numbering.xml"] = ET.tostring(numbering_root, encoding="utf-8", xml_declaration=True)

with ZipFile(TARGET, "w", compression=ZIP_DEFLATED) as target_zip:
    for name, data in entries.items():
        target_zip.writestr(name, data)

print(TARGET)
