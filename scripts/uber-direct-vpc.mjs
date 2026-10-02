#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { assertActiveRecognizedNetwork, assertConnectorReady, assertSchedulerTarget, validateInfrastructure } from './uber-direct-vpc-validation.mjs';

const DEFAULTS = {
  project: 'smart-converter-752gf',
  region: 'southamerica-east1',
  function: 'uberSftpDailySync',
  network: 'default',
  subnet: 'default',
  connector: 'coala-uber-sftp',
  router: 'coala-uber-egress-router',
  nat: 'coala-uber-egress-nat',
  address: 'coala-uber-egress-ip',
  expectedIp: '34.151.241.62',
  scheduler: 'firebase-schedule-uberSftpDailySync-southamerica-east1',
};

const NETWORK_FIELDS = [
  'serviceConfig.vpcConnector',
  'serviceConfig.vpcConnectorEgressSettings',
  'serviceConfig.directVpcNetworkInterface',
  'serviceConfig.directVpcEgress',
].join(',');

function usage() {
  console.log(`Uso:
  npm run uber-sftp:network -- preflight [opções]
  npm run uber-sftp:network -- apply [opções]
  npm run uber-sftp:network -- verify [opções]
  npm run uber-sftp:network -- rollback [opções]

Opções:
  --project <id>       padrão: ${DEFAULTS.project}
  --region <região>    padrão: ${DEFAULTS.region}
  --function <nome>    padrão: ${DEFAULTS.function}
  --network <nome>     padrão: ${DEFAULTS.network}
  --subnet <nome>      padrão: ${DEFAULTS.subnet}
  --connector <nome>   padrão: ${DEFAULTS.connector}
  --router <nome>      padrão: ${DEFAULTS.router}
  --nat <nome>         padrão: ${DEFAULTS.nat}
  --address <nome>     padrão: ${DEFAULTS.address}
  --expected-ip <ip>   padrão: ${DEFAULTS.expectedIp}
  --scheduler <nome>   padrão: ${DEFAULTS.scheduler}`);
}

function parseArguments(argv) {
  const [action, ...rest] = argv;
  if (!action || action === '--help' || action === '-h') return { action: 'help', options: DEFAULTS };
  if (!['preflight', 'apply', 'verify', 'rollback'].includes(action)) {
    throw new Error(`Ação desconhecida: ${action}`);
  }
  const options = { ...DEFAULTS };
  const optionNames = {
    '--project': 'project',
    '--region': 'region',
    '--function': 'function',
    '--network': 'network',
    '--subnet': 'subnet',
    '--connector': 'connector',
    '--router': 'router',
    '--nat': 'nat',
    '--address': 'address',
    '--expected-ip': 'expectedIp',
    '--scheduler': 'scheduler',
  };
  for (let index = 0; index < rest.length; index += 2) {
    const key = optionNames[rest[index]];
    const value = rest[index + 1];
    if (!key || !value) throw new Error(`Opção inválida ou sem valor: ${rest[index] ?? ''}`);
    options[key] = value;
  }
  return { action, options };
}

function accessToken() {
  for (const arguments_ of [
    ['auth', 'print-access-token'],
    ['auth', 'application-default', 'print-access-token'],
  ]) {
    try {
      return execFileSync('gcloud', arguments_, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    } catch {
      // Try the next official gcloud credential source without printing tokens.
    }
  }
  throw new Error('Não foi possível obter um token do gcloud.');
}

async function apiRequest(url, token, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(`Cloud Functions API: ${message}`);
  }
  return body;
}

function functionResource(options) {
  return `projects/${options.project}/locations/${options.region}/functions/${options.function}`;
}

function fullNetwork(options) {
  return `projects/${options.project}/global/networks/${options.network}`;
}

function fullSubnet(options) {
  return `projects/${options.project}/regions/${options.region}/subnetworks/${options.subnet}`;
}

function fullConnector(options) {
  return `projects/${options.project}/locations/${options.region}/connectors/${options.connector}`;
}

async function getFunction(options, token) {
  return apiRequest(`https://cloudfunctions.googleapis.com/v2/${functionResource(options)}`, token);
}

function directInterfaces(cloudFunction) {
  const value = cloudFunction?.serviceConfig?.directVpcNetworkInterface;
  return Array.isArray(value) ? value : [];
}

function hasDirectVpc(cloudFunction, options) {
  const interfaces = directInterfaces(cloudFunction);
  return interfaces.length === 1
    && interfaces[0].network === fullNetwork(options)
    && interfaces[0].subnetwork === fullSubnet(options)
    && cloudFunction?.serviceConfig?.directVpcEgress === 'VPC_EGRESS_ALL_TRAFFIC'
    && !cloudFunction?.serviceConfig?.vpcConnector;
}

function hasConnector(cloudFunction, options) {
  return cloudFunction?.serviceConfig?.vpcConnector === fullConnector(options)
    && cloudFunction?.serviceConfig?.vpcConnectorEgressSettings === 'ALL_TRAFFIC'
    && directInterfaces(cloudFunction).length === 0;
}

function describeNetworkState(cloudFunction) {
  const service = cloudFunction?.serviceConfig ?? {};
  return {
    state: cloudFunction?.state,
    connector: service.vpcConnector || null,
    connectorEgress: service.vpcConnectorEgressSettings || null,
    directInterfaces: directInterfaces(cloudFunction),
    directEgress: service.directVpcEgress || null,
    revision: service.revision || null,
  };
}

async function preflightInfrastructure(options, token) {
  const computeBase = `https://compute.googleapis.com/compute/v1/projects/${options.project}`;
  const [subnet, router, address] = await Promise.all([
    apiRequest(`${computeBase}/regions/${options.region}/subnetworks/${options.subnet}`, token),
    apiRequest(`${computeBase}/regions/${options.region}/routers/${options.router}`, token),
    apiRequest(`${computeBase}/regions/${options.region}/addresses/${options.address}`, token),
  ]);
  const nat = validateInfrastructure({ subnet, router, address, options });

  console.log(JSON.stringify({
    subnet: subnet.name,
    cidr: subnet.ipCidrRange,
    network: options.network,
    nat: nat.name,
    natCoverage: nat.sourceSubnetworkIpRangesToNat,
    address: address.name,
    configuredNatIp: address.address,
  }, null, 2));
}

async function preflight(options, token) {
  await preflightInfrastructure(options, token);
  const cloudFunction = await getFunction(options, token);
  assertActiveRecognizedNetwork(cloudFunction, hasConnector(cloudFunction, options), hasDirectVpc(cloudFunction, options));
  await verifyScheduler(options, token, cloudFunction);
  console.log(JSON.stringify({ function: options.function, ...describeNetworkState(cloudFunction) }, null, 2));
  return cloudFunction;
}

async function waitForOperation(operation, token) {
  let current = operation;
  while (!current.done) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    current = await apiRequest(`https://cloudfunctions.googleapis.com/v2/${current.name}`, token);
  }
  if (current.error) {
    throw new Error(`Operação ${current.name} falhou: ${current.error.message || current.error.code}`);
  }
  return current;
}

async function patchNetwork(options, token, serviceConfig) {
  const url = new URL(`https://cloudfunctions.googleapis.com/v2/${functionResource(options)}`);
  url.searchParams.set('updateMask', NETWORK_FIELDS);
  const operation = await apiRequest(url, token, {
    method: 'PATCH',
    body: JSON.stringify({ name: functionResource(options), serviceConfig }),
  });
  console.log(`Operação iniciada: ${operation.name}`);
  await waitForOperation(operation, token);
}

async function apply(options, token) {
  const before = await preflight(options, token);
  if (hasDirectVpc(before, options)) {
    console.log('Direct VPC egress já está configurado; nenhuma alteração aplicada.');
    return;
  }
  await verifyConnector(options, token);
  await patchNetwork(options, token, {
    vpcConnector: null,
    vpcConnectorEgressSettings: null,
    directVpcNetworkInterface: [{ network: fullNetwork(options), subnetwork: fullSubnet(options) }],
    directVpcEgress: 'VPC_EGRESS_ALL_TRAFFIC',
  });
  await verify(options, token, false);
}

async function verifyScheduler(options, token, cloudFunction) {
  const schedulerResource = `projects/${options.project}/locations/${options.region}/jobs/${options.scheduler}`;
  const scheduler = await apiRequest(`https://cloudscheduler.googleapis.com/v1/${schedulerResource}`, token);
  assertSchedulerTarget(scheduler, cloudFunction, options);
  return scheduler.state;
}

async function verifyConnector(options, token) {
  const connector = await apiRequest(`https://vpcaccess.googleapis.com/v1/${fullConnector(options)}`, token);
  assertConnectorReady(connector, options);
}

async function verify(options, token, includeInfrastructure = true) {
  if (includeInfrastructure) await preflightInfrastructure(options, token);
  const cloudFunction = await getFunction(options, token);
  if (cloudFunction.state !== 'ACTIVE' || !hasDirectVpc(cloudFunction, options)) {
    console.log(JSON.stringify(describeNetworkState(cloudFunction), null, 2));
    throw new Error('A função não está ACTIVE com Direct VPC egress para todo o tráfego.');
  }
  const schedulerState = await verifyScheduler(options, token, cloudFunction);
  console.log(JSON.stringify({
    function: options.function,
    ...describeNetworkState(cloudFunction),
    scheduler: options.scheduler,
    schedulerState,
    configuredNatIp: options.expectedIp,
  }, null, 2));
}

async function rollback(options, token) {
  const current = await getFunction(options, token);
  assertActiveRecognizedNetwork(current, hasConnector(current, options), hasDirectVpc(current, options));
  await verifyConnector(options, token);
  if (hasConnector(current, options)) {
    console.log('O conector já está restaurado; nenhuma alteração aplicada.');
    return;
  }
  await patchNetwork(options, token, {
    vpcConnector: fullConnector(options),
    vpcConnectorEgressSettings: 'ALL_TRAFFIC',
    directVpcNetworkInterface: null,
    directVpcEgress: null,
  });
  const restored = await getFunction(options, token);
  if (restored.state !== 'ACTIVE' || !hasConnector(restored, options)) {
    console.log(JSON.stringify(describeNetworkState(restored), null, 2));
    throw new Error('O rollback terminou sem restaurar o conector esperado.');
  }
  console.log(JSON.stringify({ function: options.function, ...describeNetworkState(restored) }, null, 2));
}

async function main() {
  const { action, options } = parseArguments(process.argv.slice(2));
  if (action === 'help') {
    usage();
    return;
  }
  const token = accessToken();
  if (action === 'preflight') await preflight(options, token);
  if (action === 'apply') await apply(options, token);
  if (action === 'verify') await verify(options, token);
  if (action === 'rollback') await rollback(options, token);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
