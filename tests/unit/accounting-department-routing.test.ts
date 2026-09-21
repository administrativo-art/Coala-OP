import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const vacationServer = readFileSync("src/features/hr/vacations/server.ts", "utf8");
const terminationServer = readFileSync("src/features/hr/termination/server.ts", "utf8");
const onboardingRoute = readFileSync("src/app/api/hr/onboarding/route.ts", "utf8");
const contactResolver = readFileSync("src/lib/company/company-process-contact.server.ts", "utf8");
const companyRepository = readFileSync("src/lib/company/internal-company-repository.ts", "utf8");
const registryRoute = readFileSync("src/app/api/registry/[...path]/route.ts", "utf8");

test("fluxos trabalhistas usam o contato global do setor pessoal da contabilidade", () => {
  assert.match(
    vacationServer,
    /resolveCompanyProcessContact\('vacation'\)[\s\S]{0,100}\?\? await resolveCompanyProcessContact\('onboarding'\)/,
  );
  assert.doesNotMatch(vacationServer, /resolveCompanyProcessContact\('(?:vacation|onboarding)', employer\)/);

  assert.equal(
    (terminationServer.match(/resolveCompanyProcessContact\("termination"\)/g) ?? []).length,
    3,
  );
  assert.doesNotMatch(terminationServer, /resolveCompanyProcessContact\("termination", employer\)/);
  assert.match(onboardingRoute, /resolveCompanyProcessContact\('onboarding'\)/);
});

test("erro de férias orienta o cadastro no escritório de contabilidade", () => {
  assert.match(vacationServer, /Cadastre no escritório de contabilidade um e-mail do Setor Pessoal/);
});

test("busca global usa índice limitado e todas as escritas mantêm sua projeção", () => {
  assert.match(contactResolver, /where\("departmentEmailPurposes", "array-contains", purpose\)[\s\S]{0,80}\.limit\(3\)/);
  assert.doesNotMatch(contactResolver, /collection\("entities"\)\.limit\(100\)/);
  assert.match(companyRepository, /departmentEmailPurposes: companyEmailPurposeIndex\(entityData\)/);
  assert.match(companyRepository, /runTransaction[\s\S]*companyEmailPurposeIndex\(entity, current\.data\(\)\)/);
  assert.match(registryRoute, /departmentEmailPurposes: companyEmailPurposeIndex\(normalizedBody\)/);
  assert.match(registryRoute, /runTransaction[\s\S]*departmentEmailPurposes: companyEmailPurposeIndex\(body, current\.data\(\)\)/);
});
