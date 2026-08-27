import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";

import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "smart-converter-752gf.firebasestorage.app";
const apply = process.argv.includes("--apply");
const ACTOR_ID = "U0Q9YZIl7XhQU2B0tB5U6Zpt5Td2";
const ACTOR_NAME = "Tiago Brasil";
const ACTOR_EMAIL = "tiagobrasilll@gmail.com";

const PEOPLE = [
  {
    key: "aliny",
    directory: "/Users/imated/Desktop/Aliny",
    userId: "kjveCeNGKwbY9C4c4ji86JJbXQz2",
    employeeId: "18688727",
    name: "Aliny Rodrigues da Silva Costa",
    signedName: "Aliny Rodrigues da Silva",
    email: "alinyrodrigues94@gmail.com",
    cpf: "605.763.613-99",
    birthDate: "1994-11-12",
    birthplace: "Pastos Bons - MA",
    city: "São Luís",
    state: "MA",
    address: "Travessa São Sebastião, 5, São Raimundo (Anjo da Guarda), São Luís/MA, CEP 65010-000",
    nationality: "Brasileira",
    maritalStatus: "Casado(a)",
    motherName: "Luzinete da Costa Rodrigues",
    fatherName: "Valdo Pereira da Silva",
    identityNumber: "039411652010-6",
    identityIssueDate: "2019-05-13",
    identityIssuer: "SSP/MA",
    voterNumber: "070344111163",
    voterZone: "091",
    voterSection: "0202",
    ctpsNumber: "6057636",
    ctpsSeries: "1399",
    ctpsDate: null,
    employeeRegistration: "25",
    employeeRegistrationNumber: "000025",
    signedAt: "2026-07-09T15:34:00-03:00",
    signedIp: "177.24.251.131",
    signedUserAgent: "Chrome/150.0.0.0 · AndroidOS 10 · ARM",
    admissionProviderId: "c60d193ee4fda79714787076ccb5371109c0a072d93b7d4cd",
    admissionProviderOriginalHash: "4af4f7a2666dfc59f10680cb77144aa90db663a78e247e46cb16462c7c25f229",
    registrySignedAt: "2026-07-11T07:21:00-03:00",
    registryProviderId: "0e5524d0148bd0b5f872a7d67e736a096dc3d56828e1b39a6",
    registryProviderOriginalHash: "ef8f526dbe00be39a73af389ee6d39c44aaf7fd32368b5be0188508fc06d38c7",
    dependentsEvidence: "Declaração explícita “Sem dependentes” no pacote documental.",
    asoFormal: false,
    asoSummary: "Exame admissional em 09/07/2026: apta, conforme Ficha Clínica da MedClinic. O arquivo recebido não está intitulado como ASO formal.",
    files: {
      admission: { contains: ["admissao", "assinado"], hash: "8f4671facc087f21e6eba955882072fc4210289caf769ede5ca66a2039b1b370" },
      registry: { contains: ["ficha registro", "assinado"], hash: "6e6fb19a5d66ac6889cd9f42646491eb36232cd0c01e1681ae507d87ff839f4f" },
      personal: { contains: ["documentacao admissao"], hash: "44398dad87061af575096207cfee842e705604e56c8d1eaabf3bd844122a131c" },
      aso: { contains: ["aso"], hash: "85a9b2ea4684668af85e08267d36736b45cbd2af8dd75cb0d0c02eb8519f8dea" },
    },
  },
  {
    key: "maria-jose",
    directory: "/Users/imated/Desktop/Maria José",
    userId: "F1qc5teL3XXEEk6Ym4LEc9JvEv53",
    employeeId: "18688741",
    name: "Maria José de Sousa Pereira",
    signedName: "Maria José de Sousa Pereira",
    email: "masousa.p40@gmail.com",
    cpf: "609.667.573-51",
    birthDate: "1992-05-26",
    birthplace: "São Luís - MA",
    city: "Paço do Lumiar",
    state: "MA",
    address: "Rua 10, Casa 17, Tambaú, Paço do Lumiar/MA, CEP 65130-000",
    nationality: "Brasileira",
    maritalStatus: "Solteiro(a)",
    motherName: "Conceição de Maria Pereira de Sousa",
    fatherName: "José Otávio Pereira",
    identityNumber: "609.667.573-51",
    identityIssueDate: "2024-09-19",
    identityIssuer: "SSP/MA",
    voterNumber: "068897031104",
    voterZone: "093",
    voterSection: "0273",
    ctpsNumber: "6096675",
    ctpsSeries: "7351",
    ctpsDate: "2024-09-19",
    employeeRegistration: "26",
    employeeRegistrationNumber: "000026",
    signedAt: "2026-07-13T16:08:00-03:00",
    signedIp: "45.160.194.211",
    signedUserAgent: "Chrome/150.0.0.0 · Windows 10.0 · x64",
    admissionProviderId: "47e450441192ace5023ba6c77afdb004ca180ab95db5a89fc",
    admissionProviderOriginalHash: "4bf4e55be1409d502cabcfd1b8ee34d4c7a247a179001cb02421f29b3c1501ef",
    registrySignedAt: "2026-07-15T11:39:00-03:00",
    registryProviderId: "5b902d562807cc14c641c15d05377d70ab5427ff231ccb113",
    registryProviderOriginalHash: "d2e49ef93f0a8e1451cc2e3a67b4838e0a473979f7a53ac980908db5140b8ac4",
    dependentsEvidence: "Campo Beneficiários em branco na Ficha de Registro e nenhum documento de dependente no pacote apresentado.",
    asoFormal: true,
    asoSummary: "ASO admissional em 09/07/2026: apta — MedClinic, exame admissional e anamnese/exame físico concluídos.",
    files: {
      admission: { contains: ["admissao", "assinado"], hash: "e208836c12e8afb4109eff44aa59d516f56596a178255c4881fbcf93dfdccb11" },
      registry: { contains: ["ficha registro", "assinado"], hash: "b4d506f41d403216d468ede5e7a7af4660cb1b2aad7a14fa5bee4c96a5342031" },
      personal: { contains: ["documentacao admissao"], hash: "97e982995d3b9b7141aa555483067d8679c2f43af01af826851f0e5fd54417a2" },
      aso: { contains: ["aso"], hash: "11cca98c7b9a662a9f2c74fec8747500780ec0341346093c255ab7ded809a8d6" },
    },
  },
];

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));
  return applicationDefault();
}

function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function deterministicId(...parts) {
  return createHash("sha256").update(parts.join(":"), "utf8").digest("hex").slice(0, 32);
}

function findFile(person, spec) {
  const entries = readdirSync(person.directory).filter((entry) => !entry.startsWith("."));
  const file = entries.find((entry) => spec.contains.every((term) => normalize(entry).includes(term)));
  if (!file) throw new Error(`Arquivo [${spec.contains.join(", ")}] não encontrado para ${person.name}.`);
  const path = join(person.directory, file);
  const buffer = readFileSync(path);
  const hash = hashBuffer(buffer);
  if (hash !== spec.hash) throw new Error(`Hash inesperado em ${file}: ${hash}`);
  return { path, name: file, buffer, hash, size: buffer.byteLength, extension: extname(file).slice(1).toLowerCase() };
}

function dateTimestamp(date) {
  return Timestamp.fromDate(new Date(`${date}T12:00:00.000Z`));
}

function valuePayload(fieldKey, value, now, sourceDocumentIds) {
  const base = {
    field_key: fieldKey,
    updated_by: ACTOR_ID,
    updated_at: now,
    source: "manual_document_import",
    source_document_ids: sourceDocumentIds,
  };
  if (value instanceof Timestamp) return { ...base, value_date: value };
  if (typeof value === "boolean") return { ...base, value_boolean: value };
  if (typeof value === "number") return { ...base, value_number: value };
  if (Array.isArray(value) || (value && typeof value === "object")) return { ...base, value_json: value };
  return { ...base, value_text: String(value) };
}

function readableCurrentValue(data) {
  if (!data) return null;
  if (Object.hasOwn(data, "value_text")) return data.value_text;
  if (Object.hasOwn(data, "value_number")) return data.value_number;
  if (Object.hasOwn(data, "value_boolean")) return data.value_boolean;
  if (Object.hasOwn(data, "value_json")) return data.value_json;
  if (data.value_date?.toDate) return data.value_date.toDate().toISOString().slice(0, 10);
  return null;
}

function documentPlan(person, files) {
  const baseFields = {
    employeeName: person.name,
    cpf: person.cpf,
    birthDate: person.birthDate,
    admissionDate: "2026-07-10",
  };
  return [
    {
      kind: "personal",
      file: files.personal,
      code: "PERSONAL_ID",
      category: "personal",
      documentType: "Documentação pessoal consolidada",
      accessLevel: "restricted",
      accessPolicyId: "HR_RESTRICTED",
      folderCode: "REGISTRATION_IDENTIFICATION",
      destinationTrail: ["Identificação", "Documentos pessoais", "Documentação admissional"],
      displayName: `Documentação pessoal admissional — ${person.name}`,
      storedBase: `${person.employeeId}__DOCUMENTACAO-PESSOAL-ADMISSIONAL__2026-07__v01`,
      status: "validated",
      extractedFields: {
        ...baseFields,
        identityNumber: person.identityNumber,
        identityIssueDate: person.identityIssueDate,
        identityIssuer: person.identityIssuer,
        voterNumber: person.voterNumber,
        voterZone: person.voterZone,
        voterSection: person.voterSection,
        birthplace: person.birthplace,
        address: person.address,
        maritalStatus: person.maritalStatus,
        motherName: person.motherName,
        fatherName: person.fatherName,
        dependentsEvidence: person.dependentsEvidence,
      },
      bundleComponents: person.key === "aliny"
        ? [
            { code: "PERSONAL_ID", label: "Carteira de identidade", pages: [1, 2] },
            { code: "CIVIL_CERTIFICATE", label: "Certidão de casamento", pages: [3] },
            { code: "ADDRESS_PROOF", label: "Comprovante de residência", pages: [4] },
            { code: "VOTER_ID", label: "Título eleitoral e declaração sem dependentes", pages: [5] },
          ]
        : [
            { code: "PERSONAL_ID", label: "Carteira de identidade", pages: [1, 2] },
            { code: "ADDRESS_PROOF", label: "Comprovante de residência", pages: [3] },
            { code: "VOTER_ID", label: "Título eleitoral", pages: [4] },
          ],
      signatureRequired: false,
      signatureStatus: "not_required",
    },
    {
      kind: "aso",
      file: files.aso,
      code: "ASO_ADMISSION",
      category: "occupational_health",
      documentType: person.asoFormal ? "ASO admissional" : "Exame admissional — ficha clínica",
      accessLevel: "confidential",
      accessPolicyId: "OCCUPATIONAL_HEALTH",
      folderCode: "OCCUPATIONAL_HEALTH_SAFETY",
      caseId: "exam-2026-07-09",
      destinationTrail: ["Saúde ocupacional", "Exame 09/07/2026", "ASO admissional"],
      displayName: person.asoFormal ? "ASO admissional — 09/07/2026" : "Exame admissional — ficha clínica — 09/07/2026",
      storedBase: `${person.employeeId}__ASO-ADMISSIONAL__2026-07-09__v01`,
      status: person.asoFormal ? "validated" : "received",
      extractedFields: {
        ...baseFields,
        examDate: "2026-07-09",
        examType: "Admissional",
        result: "Apto",
        clinicName: "MedClinic",
        formalAso: person.asoFormal,
      },
      validationWarning: person.asoFormal ? null : "O arquivo está intitulado Ficha Clínica, não Atestado de Saúde Ocupacional. Manter pendente até apresentação do ASO formal.",
      signatureRequired: false,
      signatureStatus: "not_required",
      externalSignaturesPresent: true,
    },
    {
      kind: "admission",
      file: files.admission,
      code: "PROBATION_CONTRACT",
      category: "admission",
      documentType: "Pacote admissional assinado",
      accessLevel: "restricted",
      accessPolicyId: "HR_RESTRICTED",
      folderCode: "ADMISSION_REGISTRATION",
      caseId: "admission-2026-07-10",
      destinationTrail: ["Admissão", "Admissão 10/07/2026", "Contrato de experiência"],
      displayName: `Pacote admissional assinado — ${person.name}`,
      storedBase: `${person.employeeId}__PACOTE-ADMISSIONAL-ASSINADO__2026-07-10__v01`,
      status: "validated",
      extractedFields: {
        ...baseFields,
        startDate: "2026-07-10",
        salary: 1787.3,
        role: "Atendente de balcão",
        workSchedule: "10:00 às 22:00; intervalo de 15:45 às 16:45",
        transportVoucherAuthorized: true,
        imageVoiceAuthorized: true,
        privacyAcknowledged: true,
      },
      bundleComponents: [
        { code: "PROBATION_CONTRACT", label: "Contrato de trabalho a título de experiência", pages: [1] },
        { code: "BANK_HOURS_AGREEMENT", label: "Acordo individual de banco de horas", pages: [2] },
        { code: "LGPD_TERM", label: "Termo de consentimento LGPD", pages: [3, 4] },
        { code: "IMAGE_VOICE_CONSENT", label: "Consentimento para uso de imagem e voz", pages: [5] },
        { code: "GOALS_BONUSES_TERM", label: "Termo de metas e bonificações", pages: [6] },
        { code: "TRANSPORT_BENEFIT_TERM", label: "Solicitação de vale-transporte", pages: [7] },
        { code: "SIGNATURE_AUDIT", label: "Relatório de assinaturas Autentique", pages: [8] },
      ],
      signatureRequired: true,
      signatureStatus: "signed",
      signedAt: person.signedAt,
      provider: "autentique",
      providerDocumentId: person.admissionProviderId,
      providerValidationUrl: `https://valida.ae/${person.admissionProviderId}`,
      providerOriginalHashSha256: person.admissionProviderOriginalHash,
    },
    {
      kind: "registry",
      file: files.registry,
      code: "EMPLOYEE_REGISTRATION",
      category: "admission",
      documentType: "Ficha de registro",
      accessLevel: "restricted",
      accessPolicyId: "HR_RESTRICTED",
      folderCode: "ADMISSION_REGISTRATION",
      caseId: "admission-2026-07-10",
      destinationTrail: ["Admissão", "Admissão 10/07/2026", "Ficha de registro"],
      displayName: `Ficha de registro assinada — ${person.name}`,
      storedBase: `${person.employeeId}__FICHA-REGISTRO-ASSINADA__2026-07-10__v01`,
      status: "validated",
      extractedFields: {
        ...baseFields,
        employeeRegistration: person.employeeRegistration,
        employeeRegistrationNumber: person.employeeRegistrationNumber,
        employerName: "CT Sorvetes Ltda",
        employerCnpj: "14.276.603/0001-25",
        ctpsNumber: person.ctpsNumber,
        ctpsSeries: person.ctpsSeries,
        identityNumber: person.identityNumber,
        salary: 1787.3,
        role: "Atendente de balcão",
      },
      signatureRequired: true,
      signatureStatus: "signed",
      signedAt: person.registrySignedAt,
      provider: "autentique",
      providerDocumentId: person.registryProviderId,
      providerValidationUrl: `https://valida.ae/${person.registryProviderId}`,
      providerOriginalHashSha256: person.registryProviderOriginalHash,
    },
  ];
}

const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId, storageBucket });
const db = getFirestore(app, "coala");
const hrDb = getFirestore(app, "coala-rh");
const bucket = getStorage(app).bucket(storageBucket);
const now = Timestamp.now();
const planOutput = [];

for (const person of PEOPLE) {
  const files = Object.fromEntries(Object.entries(person.files).map(([kind, spec]) => [kind, findFile(person, spec)]));
  const userRef = db.collection("users").doc(person.userId);
  const employeeRef = hrDb.collection("employees").doc(person.employeeId);
  const [userSnap, employeeSnap, existingDocuments] = await Promise.all([
    userRef.get(),
    employeeRef.get(),
    hrDb.collection("employeeDocuments").where("employeeId", "==", person.employeeId).get(),
  ]);
  if (!userSnap.exists || normalize(userSnap.get("email")) !== normalize(person.email)) throw new Error(`Usuário incorreto para ${person.name}.`);
  if (!employeeSnap.exists || normalize(employeeSnap.get("email")) !== normalize(person.email)) throw new Error(`Registro RH/Bizneo incorreto para ${person.name}.`);
  const linkedBizneo = userSnap.get("registrationIdBizneo");
  if (linkedBizneo && String(linkedBizneo) !== person.employeeId) throw new Error(`Conflito de matrícula Bizneo para ${person.name}.`);
  const linkedAuth = employeeSnap.get("auth_uid");
  if (linkedAuth && linkedAuth !== person.userId) throw new Error(`Conflito de vínculo Auth no registro RH de ${person.name}.`);

  const docs = documentPlan(person, files).map((document) => {
    const id = deterministicId("historical-admission", person.employeeId, document.kind, document.file.hash);
    const extension = document.file.extension || "bin";
    return {
      ...document,
      id,
      storageSubfolder: `hr/employee-documents/${person.employeeId}/documents/${id}`,
      storagePath: `hr/employee-documents/${person.employeeId}/documents/${id}/versions/01/original.${extension}`,
      storedName: `${document.storedBase}.${extension}`,
      existing: existingDocuments.docs.find((item) => item.id === id)?.data() ?? null,
    };
  });

  for (const document of docs) {
    if (document.existing && document.existing.contentHash !== document.file.hash) {
      throw new Error(`Documento ${document.id} já existe com hash divergente.`);
    }
    const sameHash = existingDocuments.docs.find((item) => item.get("contentHash") === document.file.hash);
    if (sameHash && sameHash.id !== document.id) throw new Error(`Arquivo duplicado já arquivado em ${sameHash.id}.`);
  }

  const sourceIds = Object.fromEntries(docs.map((document) => [document.kind, document.id]));
  const fieldValues = {
    "employee.name": person.name,
    "employee.state": person.state,
    "employee.city": person.city,
    "employee.address": person.address,
    "employee.personal_email": person.email,
    "employee.nationality": person.nationality,
    "employee.birth_date": dateTimestamp(person.birthDate),
    "employee.marital_status": person.maritalStatus,
    "employee.mother_name": person.motherName,
    "employee.father_name": person.fatherName,
    "employee.children_under_14": "Nenhum",
    "employee.cpf": person.cpf,
    "employee.ctps_number": person.ctpsNumber,
    "employee.ctps_series": person.ctpsSeries,
    ...(person.ctpsDate ? { "employee.ctps_date": dateTimestamp(person.ctpsDate) } : {}),
    "employee.has_cnh": false,
    "employee.employer_cnpj": "14.276.603/0001-25",
    "employee.employer_name": "CT Sorvetes Ltda",
    "employee.job_role_id": "Atendente de balcão",
    "employee.has_vt": true,
    "employee.vt_daily_value": 8.4,
    "employee.vt_notes": "Opção pelo vale-transporte assinada no pacote admissional; tarifa total informada de R$ 8,40 por dia trabalhado.",
    "employee.education_level": "Médio completo",
    "employee.is_pcd": false,
    "employee.ethnicity": "Parda",
    "employee.aso_admission_date": dateTimestamp("2026-07-09"),
    "employee.has_family_salary": false,
    "system.documents.registration_bizneo": person.employeeId,
    "system.documents.email": person.email,
    "system.role.job_role": "Atendente de quiosque",
    "system.role.operational": true,
    "system.role.goals": true,
    "system.role.functions": "Atendente de balcão",
    "system.schedule.units": "Quiosque João Paulo; Quiosque Tirirical",
    "system.aso.summary": person.asoSummary,
    "system.family_salary.summary": `Sem dependentes menores de 14 anos cadastrados. ${person.dependentsEvidence} Salário-família não aplicável no cadastro atual.`,
    "system.transport_voucher.enabled": true,
    "system.behavior.operational": true,
    "system.behavior.goals": true,
  };

  const currentFields = {};
  for (const fieldKey of Object.keys(fieldValues)) {
    const current = await employeeRef.collection("field_values").doc(fieldKey).get();
    currentFields[fieldKey] = current.exists ? readableCurrentValue(current.data()) : null;
  }

  planOutput.push({
    person: person.name,
    userId: person.userId,
    employeeId: person.employeeId,
    linking: { registrationIdBizneo: linkedBizneo ?? null, authUid: linkedAuth ?? null },
    correctedValues: { asoAdmissionDate: "2026-07-09", needsTransportVoucher: true },
    fieldsToPopulate: Object.keys(fieldValues).length,
    currentFields,
    documents: docs.map((document) => ({
      id: document.id,
      kind: document.kind,
      file: document.file.name,
      hash: document.file.hash,
      status: document.status,
      storagePath: document.storagePath,
      alreadyImported: Boolean(document.existing),
      warning: document.validationWarning ?? null,
    })),
  });

  if (!apply) continue;

  for (const document of docs) {
    const storageFile = bucket.file(document.storagePath);
    const [exists] = await storageFile.exists();
    if (exists) {
      const [stored] = await storageFile.download();
      if (hashBuffer(stored) !== document.file.hash) throw new Error(`Arquivo no Storage diverge em ${document.storagePath}.`);
    } else {
      await storageFile.save(document.file.buffer, {
        resumable: false,
        metadata: {
          contentType: document.file.extension === "pdf" ? "application/pdf" : "image/png",
          cacheControl: "private, max-age=0, no-store",
          metadata: {
            employeeId: person.employeeId,
            documentId: document.id,
            contentHash: document.file.hash,
            source: "manual_document_import",
          },
        },
      });
    }
  }

  const batch = hrDb.batch();
  const consent = {
    autorizado: true,
    respondido_em: person.signedAt,
    versao_termo: "legado-autentique-2026-07",
    ip: person.signedIp,
    user_agent: person.signedUserAgent,
    hash_termo_exibido: person.admissionProviderOriginalHash,
    termo_snapshot_id: null,
    protocolo: person.admissionProviderId,
    origem: "manual_import_legacy_signed_bundle",
    onboarding_id: null,
  };
  const privacy = {
    acknowledged: true,
    noticeVersion: "legado-autentique-2026-07",
    noticeHash: person.admissionProviderOriginalHash,
    noticeTitle: "Termo de Consentimento para Tratamento de Dados Pessoais – LGPD",
    firstAcceptedAt: person.signedAt,
    lastConfirmedAt: person.signedAt,
    privacyNoticeSnapshotId: null,
    onboarding_id: null,
    origin: "manual_import_legacy_signed_bundle",
  };
  batch.set(employeeRef, {
    auth_uid: person.userId,
    source_user_id: person.userId,
    job_role_id: userSnap.get("jobRoleId") || null,
    profile_completion: 60,
    consentimento_imagem_voz: consent,
    ciencia_privacidade_onboarding: privacy,
    updated_at: now,
  }, { merge: true });
  batch.set(employeeRef.collection("consentimentos_imagem_voz_historico").doc(person.admissionProviderId), {
    ...consent,
    evento: "autorizacao_concedida",
    employee_id: person.employeeId,
    imported_at: now,
    imported_by: ACTOR_ID,
  }, { merge: true });

  for (const [fieldKey, value] of Object.entries(fieldValues)) {
    const evidence = fieldKey.includes("aso")
      ? [sourceIds.aso]
      : fieldKey.includes("vt") || fieldKey.includes("transport")
        ? [sourceIds.admission]
        : fieldKey.includes("ctps") || fieldKey.includes("employer") || fieldKey.includes("job_role")
          ? [sourceIds.registry, sourceIds.admission]
          : fieldKey.includes("family") || fieldKey.includes("children")
            ? [sourceIds.personal, sourceIds.registry]
            : [sourceIds.personal, sourceIds.registry];
    const fieldRef = employeeRef.collection("field_values").doc(fieldKey);
    batch.set(fieldRef, valuePayload(fieldKey, value, now, evidence), { merge: true });
    const auditId = deterministicId("manual-field-import", person.employeeId, fieldKey, "2026-07-admission");
    batch.set(hrDb.collection("audit_log").doc(auditId), {
      employee_id: person.employeeId,
      field_key: fieldKey,
      old_value: currentFields[fieldKey],
      new_value: value instanceof Timestamp ? value.toDate().toISOString().slice(0, 10) : value,
      changed_by: ACTOR_ID,
      changed_by_name: ACTOR_NAME,
      changed_at: now,
      source: "manual_document_import",
      document_ids: evidence,
    }, { merge: true });
  }

  for (const document of docs) {
    const documentRef = hrDb.collection("employeeDocuments").doc(document.id);
    const mimeType = document.file.extension === "pdf" ? "application/pdf" : "image/png";
    const payload = {
      employeeId: person.employeeId,
      candidateId: null,
      category: document.category,
      documentType: document.documentType,
      documentTypeCode: document.code,
      accessLevel: document.accessLevel,
      accessPolicyId: document.accessPolicyId,
      status: document.status,
      signatureRequired: document.signatureRequired,
      signatureStatus: document.signatureStatus,
      externalSignaturesPresent: document.externalSignaturesPresent ?? false,
      folderCode: document.folderCode,
      caseId: document.caseId ?? null,
      subcaseId: null,
      destinationTrail: document.destinationTrail,
      displayName: document.displayName,
      storedName: document.storedName,
      originalName: basename(document.file.path),
      mimeType,
      size: document.file.size,
      contentHash: document.file.hash,
      hashAlgorithm: "sha256",
      logicalKey: `${person.employeeId}|${document.code}|${document.kind}|2026-07`,
      version: 1,
      versionResolution: "NEW_DOCUMENT",
      storagePath: document.storagePath,
      storageSubfolder: document.storageSubfolder,
      extractedFields: document.extractedFields,
      bundleComponents: document.bundleComponents ?? [],
      validationWarning: document.validationWarning ?? null,
      source: "manual_document_import",
      sourceDirectoryLabel: basename(person.directory),
      provider: document.provider ?? null,
      providerDocumentId: document.providerDocumentId ?? null,
      providerValidationUrl: document.providerValidationUrl ?? null,
      providerOriginalHashSha256: document.providerOriginalHashSha256 ?? null,
      signedAt: document.signedAt ?? null,
      uploadedBy: ACTOR_ID,
      uploadedByName: ACTOR_NAME,
      importedByEmail: ACTOR_EMAIL,
      validatedBy: document.status === "validated" ? ACTOR_ID : null,
      validatedByName: document.status === "validated" ? ACTOR_NAME : null,
      validatedAt: document.status === "validated" ? now : null,
      uploadedAt: now,
      importedAt: now,
      updatedAt: now,
      accessCount: 0,
      deletedAt: null,
    };
    batch.set(documentRef, payload, { merge: true });
    batch.set(documentRef.collection("audit").doc(deterministicId("manual-import", document.id)), {
      action: "DOCUMENT_IMPORTED_AND_CLASSIFIED",
      actorId: ACTOR_ID,
      actorName: ACTOR_NAME,
      actorEmail: ACTOR_EMAIL,
      employeeId: person.employeeId,
      documentTypeCode: document.code,
      contentHash: document.file.hash,
      note: document.validationWarning ?? "Documento histórico conferido e arquivado pelo RH.",
      at: now,
    }, { merge: true });
  }

  await batch.commit();
  await userRef.set({
    registrationIdBizneo: person.employeeId,
    needsTransportVoucher: true,
    updatedAt: now,
  }, { merge: true });
}

const result = { apply, projectId, people: planOutput, completedAt: new Date().toISOString() };
if (process.argv.includes("--summary")) {
  console.log(JSON.stringify({
    apply,
    projectId,
    people: planOutput.map((person) => ({
      person: person.person,
      employeeId: person.employeeId,
      linking: person.linking,
      fieldsPopulated: Object.values(person.currentFields).filter((value) => value !== null).length,
      documents: person.documents.map((document) => ({
        kind: document.kind,
        status: document.status,
        alreadyImported: document.alreadyImported,
        warning: document.warning,
      })),
    })),
    completedAt: result.completedAt,
  }, null, 2));
} else {
  console.log(JSON.stringify(result, null, 2));
}
