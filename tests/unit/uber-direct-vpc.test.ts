import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  assertActiveRecognizedNetwork,
  assertConnectorReady,
  assertSchedulerTarget,
  validateInfrastructure,
} from '../../scripts/uber-direct-vpc-validation.mjs';
import {
  SFTP_CONNECTION_ATTEMPTS,
  SFTP_READY_TIMEOUT_MS,
  sftpConnectionRetryDelay,
} from '../../functions/src/uber-sftp/connection-policy';

const options = {
  project: 'smart-converter-752gf', region: 'southamerica-east1', function: 'uberSftpDailySync',
  network: 'default', subnet: 'default', connector: 'coala-uber-sftp',
  router: 'coala-uber-egress-router', nat: 'coala-uber-egress-nat',
  address: 'coala-uber-egress-ip', expectedIp: '34.151.241.62',
  scheduler: 'firebase-schedule-uberSftpDailySync-southamerica-east1',
};
const network = `https://www.googleapis.com/compute/v1/projects/${options.project}/global/networks/default`;
const natIp = `https://www.googleapis.com/compute/v1/projects/${options.project}/regions/${options.region}/addresses/${options.address}`;

function fixture() {
  return {
    options,
    subnet: { network, ipCidrRange: '10.1.0.0/24' },
    router: { network, nats: [{
      name: options.nat, sourceSubnetworkIpRangesToNat: 'ALL_SUBNETWORKS_ALL_IP_RANGES',
      natIpAllocateOption: 'MANUAL_ONLY', natIps: [natIp],
    }] },
    address: { address: options.expectedIp },
  };
}

test('NAT aceita apenas Router na VPC da sub-rede e IP manual único', () => {
  const input = fixture();
  assert.equal(validateInfrastructure(input), input.router.nats[0]);
  input.router.network = network.replace('/default', '/other');
  assert.throws(() => validateInfrastructure(input), /VPC/);
  input.router.network = network;
  input.router.nats[0].natIpAllocateOption = 'AUTO_ONLY';
  assert.throws(() => validateInfrastructure(input), /MANUAL_ONLY/);
  input.router.nats[0].natIpAllocateOption = 'MANUAL_ONLY';
  input.router.nats[0].natIps.push(natIp);
  assert.throws(() => validateInfrastructure(input), /MANUAL_ONLY/);
  input.router.nats[0].natIps = [natIp.replace(options.project, 'other-project')];
  assert.throws(() => validateInfrastructure(input), /MANUAL_ONLY/);
});

test('CIDR rejeita prefixos negativos, maiores que /26 e malformados', () => {
  const input = fixture();
  for (const cidr of ['10.0.0.0/-1', '10.0.0.0/27', '10.0.0.0/foo']) {
    input.subnet.ipCidrRange = cidr;
    assert.throws(() => validateInfrastructure(input), /\/26/);
  }
});

const cloudFunction = {
  url: 'https://southamerica-east1-smart-converter-752gf.cloudfunctions.net/uberSftpDailySync',
  serviceConfig: { uri: 'https://ubersftpdailysync-qsrxz2aeqa-rj.a.run.app' },
};

function scheduler(uri: string) {
  return { state: 'ENABLED', httpTarget: {
    uri, httpMethod: 'POST', oidcToken: { audience: uri },
  } };
}

test('Scheduler aceita URL oficial Cloud Functions e URL Cloud Run da mesma função', () => {
  assert.doesNotThrow(() => assertSchedulerTarget(scheduler(cloudFunction.url), cloudFunction, options));
  assert.doesNotThrow(() => assertSchedulerTarget(scheduler(cloudFunction.serviceConfig.uri), cloudFunction, options));
});

test('Scheduler rejeita outro destino, método, audience e estado', () => {
  const job = scheduler(cloudFunction.url);
  job.httpTarget.uri = 'https://other.example.com';
  assert.throws(() => assertSchedulerTarget(job, cloudFunction, options), /não aponta/);
  job.httpTarget.uri = cloudFunction.url;
  job.httpTarget.httpMethod = 'GET';
  assert.throws(() => assertSchedulerTarget(job, cloudFunction, options), /POST/);
  job.httpTarget.httpMethod = 'POST';
  job.httpTarget.oidcToken.audience = cloudFunction.serviceConfig.uri;
  assert.throws(() => assertSchedulerTarget(job, cloudFunction, options), /audience/);
  job.httpTarget.oidcToken.audience = job.httpTarget.uri;
  job.state = 'PAUSED';
  assert.throws(() => assertSchedulerTarget(job, cloudFunction, options), /ENABLED/);
});

test('PATCH exige função ACTIVE em estado de rede reconhecido', () => {
  assert.doesNotThrow(() => assertActiveRecognizedNetwork({ state: 'ACTIVE' }, true, false));
  assert.throws(() => assertActiveRecognizedNetwork({ state: 'DEPLOYING' }, true, false), /ACTIVE/);
  assert.throws(() => assertActiveRecognizedNetwork({ state: 'ACTIVE' }, false, false), /ACTIVE/);
});

test('rollback exige conector esperado e READY', () => {
  const connector = { name: `projects/${options.project}/locations/${options.region}/connectors/${options.connector}`, state: 'READY' };
  assert.doesNotThrow(() => assertConnectorReady(connector, options));
  assert.throws(() => assertConnectorReady({ ...connector, state: 'ERROR' }, options), /READY/);
  assert.throws(() => assertConnectorReady({ ...connector, name: 'projects/other/locations/x/connectors/x' }, options), /READY/);
});

test('conexão SFTP mantém timeout 90s, até três tentativas e apenas erros transitórios', () => {
  assert.equal(SFTP_READY_TIMEOUT_MS, 90_000);
  assert.equal(SFTP_CONNECTION_ATTEMPTS, 3);
  const timeout = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
  assert.equal(sftpConnectionRetryDelay(1, timeout), 5_000);
  assert.equal(sftpConnectionRetryDelay(2, timeout), 15_000);
  assert.equal(sftpConnectionRetryDelay(3, timeout), null);
  assert.equal(sftpConnectionRetryDelay(1, new Error('authentication failed')), null);
  assert.equal(sftpConnectionRetryDelay(1, new Error('host fingerprint mismatch')), null);
});

test('deploy Firebase preserva a rede externa e não reintroduz o conector no job', async () => {
  const source = await readFile(new URL('../../functions/src/uber-sftp/jobs.ts', import.meta.url), 'utf8');
  assert.match(source, /preserveExternalChanges:\s*true/);
  assert.doesNotMatch(source, /vpcConnector\s*:/);
  assert.doesNotMatch(source, /vpcConnectorEgressSettings\s*:/);
});
