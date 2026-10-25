import { createHash, createPrivateKey, sign, verify, X509Certificate, type KeyObject } from 'node:crypto';

import { PDFDocument, PDFName, PDFRef } from 'pdf-lib';

import { CnpjValidator } from '@/lib/company/cnpj-validator';
import { AppError } from '@/lib/observability/app-error';

import type { RepPCadesSigner } from './afd';
import { decodeOid, der, parseDer, tlv, type DerNode } from './der';
import type { RepPPadesSigner } from './receipt';

const OID = Object.freeze({
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  signaturePolicyId: '1.2.840.113549.1.9.16.2.15',
  spqEtsUri: '1.2.840.113549.1.9.16.5.1',
  sha256: '2.16.840.1.101.3.4.2.1',
  sha256WithRsa: '1.2.840.113549.1.1.11',
  ecdsaWithSha256: '1.2.840.10045.4.3.2',
  subjectAltName: '2.5.29.17',
  icpBrasilCnpj: '2.16.76.1.3.3',
});
const PADES_CONTENTS_BYTES = 16_384;

/**
 * Política ICP-Brasil AD-RB vigente para CAdES (LPA_CAdES assinada pelo ITI, conferida em 18/10/2026):
 * v2.4, válida de 12/06/2025 a 22/10/2037. O hash é do arquivo .der da política, guardado em docs/rep-p/referencias.
 */
export const REP_P_CADES_SIGNATURE_POLICY = Object.freeze({
  oid: '2.16.76.1.7.1.1.2.4',
  sha256: '25f148b0828c0ba93695742469566fcc4d1618aa0c20cac56ae72b3419ecee6b',
  uri: 'http://politicas.icpbrasil.gov.br/PA_AD_RB_v2_4.der',
});
export type RepPSignaturePolicy = Readonly<{ oid: string; sha256: string; uri: string }>;
export const REP_P_ICP_EXPIRY_WARNING_DAYS = 30;
const BYTE_RANGE_PLACEHOLDER = '0000000000 0000000000 0000000000';

/** Credencial ICP-Brasil A1 já carregada: chave privada, certificado do titular e cadeia enviada junto. */
export type RepPIcpIdentity = Readonly<{
  privateKey: KeyObject;
  certificate: X509Certificate;
  chain: readonly X509Certificate[];
  cnpj: string;
  notBefore: Date;
  notAfter: Date;
}>;

function sha256(value: Buffer) { return createHash('sha256').update(value).digest(); }
function credentialError(code: string, safeMessage: string) {
  return new AppError({ code, kind: 'TRANSIENT_EXTERNAL', retryable: false, safeMessage });
}

/** Partes do TBSCertificate usadas em sid/ESS: número de série e emissor, copiados sem reencode. */
function certificateParts(certificate: X509Certificate) {
  const tbs = parseDer(certificate.raw).children[0];
  const offset = tbs.children[0].tag === 0xa0 ? 1 : 0;
  return { serial: tbs.children[offset], issuer: tbs.children[offset + 2], tbs };
}

/** CNPJ do e-CNPJ: otherName 2.16.76.1.3.3 do SubjectAltName; na falta, sufixo ":CNPJ" do CN. */
export function icpCertificateCnpj(certificate: X509Certificate): string | null {
  const { tbs } = certificateParts(certificate);
  const extensions = tbs.children.find((child) => child.tag === 0xa3)?.children[0]?.children ?? [];
  for (const extension of extensions) {
    if (decodeOid(extension.children[0]) !== OID.subjectAltName) continue;
    const names = parseDer(extension.children[extension.children.length - 1].content).children;
    for (const name of names) {
      if (name.tag !== 0xa0 || decodeOid(name.children[0]) !== OID.icpBrasilCnpj) continue;
      const value = name.children[1]?.children[0];
      const digits = value?.content.toString('latin1').replace(/\D/g, '') ?? '';
      if (CnpjValidator.validate(digits).valid) return CnpjValidator.clean(digits);
    }
  }
  const fromCommonName = /CN=[^\n]*:(\d{14})/.exec(certificate.subject)?.[1];
  return fromCommonName && CnpjValidator.validate(fromCommonName).valid ? fromCommonName : null;
}

/**
 * Lê o pacote PEM guardado no segredo (chave privada sem senha + certificados) e exige
 * que um certificado corresponda à chave, tenha CNPJ ICP-Brasil e esteja vigente.
 */
export function loadRepPIcpIdentity(pem: string, expectedCnpj: string, now = new Date()): RepPIcpIdentity {
  const identity = parseRepPIcpIdentity(pem, expectedCnpj);
  assertRepPIcpIdentityValid(identity, now);
  return identity;
}

export type RepPIcpCredentialStatus =
  | Readonly<{ state: 'unconfigured' }>
  | Readonly<{ state: 'invalid'; issue: string }>
  | Readonly<{ state: 'valid' | 'expiring' | 'expired' | 'not_yet_valid'; cnpj: string; subject: string; fingerprint: string;
    notBefore: string; notAfter: string; daysRemaining: number; warningDays: number }>;

/** Situação da credencial para monitoração, sem expor chave nem lançar erro por vencimento. */
export function inspectRepPIcpCredential(pem: string | undefined, expectedCnpj: string, now = new Date()): RepPIcpCredentialStatus {
  if (!pem?.trim()) return { state: 'unconfigured' };
  let identity: RepPIcpIdentity;
  try {
    identity = parseRepPIcpIdentity(pem, expectedCnpj);
  } catch (cause) {
    return { state: 'invalid', issue: cause instanceof AppError ? cause.code : 'REP_P_ICP_CREDENTIAL_INVALID' };
  }
  const daysRemaining = Math.floor((identity.notAfter.getTime() - now.getTime()) / 86_400_000);
  const state = now < identity.notBefore ? 'not_yet_valid' : now > identity.notAfter ? 'expired'
    : daysRemaining <= REP_P_ICP_EXPIRY_WARNING_DAYS ? 'expiring' : 'valid';
  return { state, cnpj: identity.cnpj, fingerprint: identity.certificate.fingerprint256, subject: /CN=([^\n]*)/.exec(identity.certificate.subject)?.[1] ?? '',
    notBefore: identity.notBefore.toISOString(), notAfter: identity.notAfter.toISOString(), daysRemaining,
    warningDays: REP_P_ICP_EXPIRY_WARNING_DAYS };
}

function parseRepPIcpIdentity(pem: string, expectedCnpj: string): RepPIcpIdentity {
  const blocks = [...pem.matchAll(/-----BEGIN ([A-Z ]+)-----[\s\S]+?-----END \1-----/g)];
  const keyBlock = blocks.find((block) => /^(RSA |EC )?PRIVATE KEY$/.test(block[1]));
  if (!keyBlock) throw credentialError('REP_P_ICP_KEY_MISSING', 'A credencial de assinatura não contém chave privada utilizável.');
  let privateKey: KeyObject;
  let certificates: X509Certificate[];
  try {
    privateKey = createPrivateKey(keyBlock[0]);
    certificates = blocks.filter((block) => block[1] === 'CERTIFICATE').map((block) => new X509Certificate(block[0]));
  } catch {
    throw credentialError('REP_P_ICP_CREDENTIAL_INVALID', 'A credencial de assinatura não pôde ser lida.');
  }
  if (privateKey.asymmetricKeyType !== 'rsa' && privateKey.asymmetricKeyType !== 'ec') {
    throw credentialError('REP_P_ICP_KEY_UNSUPPORTED', 'Tipo de chave da credencial não suportado.');
  }
  const certificate = certificates.find((candidate) => candidate.checkPrivateKey(privateKey));
  if (!certificate) throw credentialError('REP_P_ICP_CERTIFICATE_MISSING', 'Nenhum certificado da credencial corresponde à chave privada.');
  const cnpj = icpCertificateCnpj(certificate);
  if (!cnpj || cnpj !== CnpjValidator.clean(expectedCnpj)) {
    throw credentialError('REP_P_ICP_CNPJ_MISMATCH', 'O certificado de assinatura não pertence ao CNPJ da desenvolvedora.');
  }
  return Object.freeze({ privateKey, certificate, cnpj,
    chain: Object.freeze(certificates.filter((candidate) => candidate !== certificate)),
    notBefore: new Date(certificate.validFrom), notAfter: new Date(certificate.validTo) });
}

export function assertRepPIcpIdentityValid(identity: RepPIcpIdentity, now = new Date()) {
  if (!(now >= identity.notBefore && now <= identity.notAfter)) {
    throw credentialError('REP_P_ICP_CERTIFICATE_EXPIRED', 'O certificado de assinatura está fora da validade.');
  }
}

function attribute(oid: string, value: Buffer) { return der.sequence(der.oid(oid), der.set(value)); }

/** SignaturePolicyId (RFC 5126 5.8.1): OID, hash SHA-256 do documento da política e a URI como qualificador. */
function signaturePolicyAttribute(policy: RepPSignaturePolicy) {
  return attribute(OID.signaturePolicyId, der.sequence(der.oid(policy.oid),
    der.sequence(der.sequence(der.oid(OID.sha256)), der.octetString(Buffer.from(policy.sha256, 'hex'))),
    der.sequence(der.sequence(der.oid(OID.spqEtsUri), tlv(0x16, Buffer.from(policy.uri, 'ascii'))))));
}

/**
 * CMS SignedData destacado (CAdES-BES): contentType, messageDigest e signing-certificate-v2; com política,
 * acrescenta sigPolicyId (CAdES-EPES/AD-RB). PAdES proíbe signingTime no CMS (o instante vai em /M); o AFD o inclui.
 */
export function buildRepPDetachedCms(identity: RepPIcpIdentity, content: Buffer,
  options: { signingTime?: Date; signaturePolicy?: RepPSignaturePolicy } = {}): Buffer {
  const { serial, issuer } = certificateParts(identity.certificate);
  const essCertId = der.sequence(der.octetString(sha256(identity.certificate.raw)),
    der.sequence(der.sequence(der.explicit(4, issuer.raw)), serial.raw));
  const signedAttributes = der.set(
    attribute(OID.contentType, der.oid(OID.data)),
    attribute(OID.messageDigest, der.octetString(sha256(content))),
    attribute(OID.signingCertificateV2, der.sequence(der.sequence(essCertId))),
    ...(options.signingTime ? [attribute(OID.signingTime, der.utcTime(options.signingTime))] : []),
    ...(options.signaturePolicy ? [signaturePolicyAttribute(options.signaturePolicy)] : []),
  );
  const rsa = identity.privateKey.asymmetricKeyType === 'rsa';
  const signatureAlgorithm = rsa ? der.sequence(der.oid(OID.sha256WithRsa), der.null()) : der.sequence(der.oid(OID.ecdsaWithSha256));
  const signature = sign('sha256', signedAttributes, identity.privateKey);
  const digestAlgorithm = der.sequence(der.oid(OID.sha256));
  const signerInfo = der.sequence(der.integer(1), der.sequence(issuer.raw, serial.raw), digestAlgorithm,
    der.implicitConstructed(0, signedAttributes), signatureAlgorithm, der.octetString(signature));
  const signedData = der.sequence(der.integer(1), der.set(digestAlgorithm), der.sequence(der.oid(OID.data)),
    der.implicitConstructed(0, der.set(identity.certificate.raw, ...identity.chain.map((item) => item.raw))),
    der.set(signerInfo));
  return der.sequence(der.oid(OID.signedData), der.explicit(0, signedData));
}

/** Confere CMS destacado sobre o conteúdo: digest, assinatura e certificado do signatário embutido. */
export function verifyRepPDetachedCms(cms: Buffer, content: Buffer): { valid: boolean; certificateCnpj: string | null } {
  try {
    const signedData = parseDer(cms).children[1].children[0];
    const certificates = signedData.children.find((child) => child.tag === 0xa0)?.children ?? [];
    const signerInfo = signedData.children[signedData.children.length - 1].children[0];
    const [, sid, , signedAttributesNode, , signatureNode] = signerInfo.children;
    const attributes = new Map(signedAttributesNode.children.map((item: DerNode) => [decodeOid(item.children[0]), item.children[1].children[0]]));
    if (!attributes.get(OID.messageDigest)?.content.equals(sha256(content))
      || !attributes.has(OID.signingCertificateV2)) return { valid: false, certificateCnpj: null };
    const certificate = certificates.map((item) => new X509Certificate(item.raw))
      .find((candidate) => certificateParts(candidate).serial.raw.equals(sid.children[1].raw)
        && certificateParts(candidate).issuer.raw.equals(sid.children[0].raw));
    if (!certificate) return { valid: false, certificateCnpj: null };
    const signedAttributes = Buffer.concat([Buffer.from([0x31]), signedAttributesNode.raw.subarray(1)]);
    const valid = verify('sha256', signedAttributes, certificate.publicKey, signatureNode.content);
    return { valid, certificateCnpj: valid ? icpCertificateCnpj(certificate) : null };
  } catch {
    return { valid: false, certificateCnpj: null };
  }
}

function pdfDate(date: Date) {
  return `D:${date.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`;
}

/**
 * Assina o PDF por atualização incremental: acrescenta dicionário /Sig, campo de assinatura,
 * página e catálogo atualizados e nova seção xref, sem tocar nos bytes originais.
 */
export async function signRepPPdfIncrementally(pdf: Buffer, identity: RepPIcpIdentity, now = new Date()): Promise<Buffer> {
  const source = pdf.toString('latin1');
  const previousXref = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(source)?.[1]);
  if (!Number.isSafeInteger(previousXref)) throw new TypeError('PDF sem xref final para atualização incremental.');
  const document = await PDFDocument.load(pdf, { updateMetadata: false });
  const { context } = document;
  const root = context.trailerInfo.Root;
  const info = context.trailerInfo.Info;
  if (!(root instanceof PDFRef)) throw new TypeError('PDF sem catálogo referenciado.');
  const page = document.getPage(0);
  const signatureNumber = context.largestObjectNumber + 1;
  const widgetRef = PDFRef.of(signatureNumber + 1);
  const existingAnnots = page.node.Annots()?.asArray() ?? [];
  page.node.set(PDFName.of('Annots'), context.obj([...existingAnnots, widgetRef]));
  document.catalog.set(PDFName.of('AcroForm'), context.obj({ Fields: [widgetRef], SigFlags: 3 }));

  const objects: Array<{ ref: PDFRef; body: string }> = [
    { ref: PDFRef.of(signatureNumber), body: `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached`
      + ` /ByteRange [0 ${BYTE_RANGE_PLACEHOLDER}] /Contents <${'0'.repeat(PADES_CONTENTS_BYTES * 2)}> /M (${pdfDate(now)}) >>` },
    { ref: widgetRef, body: `<< /Type /Annot /Subtype /Widget /FT /Sig /T (Assinatura REP-P) /V ${signatureNumber} 0 R`
      + ` /Rect [0 0 0 0] /F 132 /P ${page.ref.toString()} >>` },
    { ref: page.ref, body: page.node.toString() },
    { ref: root, body: document.catalog.toString() },
  ];
  let increment = '\n';
  const offsets = new Map<PDFRef, number>();
  for (const object of objects) {
    offsets.set(object.ref, pdf.length + increment.length);
    increment += `${object.ref.objectNumber} ${object.ref.generationNumber} obj\n${object.body}\nendobj\n`;
  }
  const xrefOffset = pdf.length + increment.length;
  increment += 'xref\n0 1\n0000000000 65535 f \n';
  for (const object of [...objects].sort((left, right) => left.ref.objectNumber - right.ref.objectNumber)) {
    increment += `${object.ref.objectNumber} 1\n${String(offsets.get(object.ref)).padStart(10, '0')} `
      + `${String(object.ref.generationNumber).padStart(5, '0')} n \n`;
  }
  increment += `trailer\n<< /Size ${signatureNumber + 2} /Root ${root.toString()}`
    + `${info instanceof PDFRef ? ` /Info ${info.toString()}` : ''} /Prev ${previousXref} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const output = Buffer.concat([pdf, Buffer.from(increment, 'latin1')]);
  const contentsStart = output.indexOf('/Contents <', pdf.length, 'latin1') + '/Contents '.length;
  const contentsEnd = output.indexOf('>', contentsStart, 'latin1') + 1;
  const byteRange = `${contentsStart} ${contentsEnd} ${output.length - contentsEnd}`.padEnd(BYTE_RANGE_PLACEHOLDER.length, ' ');
  if (byteRange.length !== BYTE_RANGE_PLACEHOLDER.length) throw new TypeError('PDF grande demais para o ByteRange reservado.');
  output.write(byteRange, output.indexOf(BYTE_RANGE_PLACEHOLDER, pdf.length, 'latin1'), 'latin1');
  const cms = buildRepPDetachedCms(identity, Buffer.concat([output.subarray(0, contentsStart), output.subarray(contentsEnd)]));
  if (cms.length > PADES_CONTENTS_BYTES) throw new TypeError('Assinatura maior que o espaço reservado no PDF.');
  output.write(cms.toString('hex').toUpperCase(), contentsStart + 1, 'latin1');
  return output;
}

/** Confere a assinatura PAdES gravada: ByteRange cobre o arquivo inteiro exceto /Contents e o CMS é válido. */
export function verifyRepPSignedPdf(pdf: Buffer): { valid: boolean; certificateCnpj: string | null } {
  const text = pdf.toString('latin1');
  const match = /\/ByteRange \[0 (\d+) (\d+) (\d+) *\] \/Contents <([0-9A-F]+)>/.exec(text);
  if (!match) return { valid: false, certificateCnpj: null };
  const [start, resume, tail] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (resume + tail !== pdf.length || pdf[start] !== 0x3c || pdf[resume - 1] !== 0x3e) return { valid: false, certificateCnpj: null };
  // O DER declara o próprio tamanho; o preenchimento com zeros depois dele é ignorado.
  return verifyRepPDetachedCms(parseDer(Buffer.from(match[4], 'hex')).raw, Buffer.concat([pdf.subarray(0, start), pdf.subarray(resume)]));
}

/** `now` dá o instante gravado na assinatura; em produção vem da Hora Legal e pode recusar. */
export function createRepPIcpSigners(identity: RepPIcpIdentity, now: () => Date | Promise<Date> = () => new Date()): {
  cades: RepPCadesSigner; pades: RepPPadesSigner;
} {
  return {
    cades: {
      async signDetached(content) {
        const instant = await now();
        assertRepPIcpIdentityValid(identity, instant);
        return { bytes: buildRepPDetachedCms(identity, content, { signingTime: instant, signaturePolicy: REP_P_CADES_SIGNATURE_POLICY }),
          format: 'CAdES', detached: true,
          certificateCnpj: identity.cnpj };
      },
    },
    pades: {
      async signPdf(content) {
        const instant = await now();
        assertRepPIcpIdentityValid(identity, instant);
        return { bytes: await signRepPPdfIncrementally(content, identity, instant), format: 'PAdES', certificateCnpj: identity.cnpj };
      },
    },
  };
}
