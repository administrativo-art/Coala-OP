const resourceEndsWith = (value, suffix) => typeof value === 'string' && value.endsWith(suffix);

export function validateInfrastructure({ subnet, router, address, options }) {
  const networkSuffix = `/projects/${options.project}/global/networks/${options.network}`;
  if (!resourceEndsWith(subnet.network, networkSuffix) || router.network !== subnet.network) {
    throw new Error(`A sub-rede e o Router ${options.router} precisam pertencer à VPC ${options.network}.`);
  }
  const cidr = subnet.ipCidrRange?.split('/');
  const prefix = cidr?.length === 2 && /^\d+$/.test(cidr[1]) ? Number(cidr[1]) : NaN;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 26) {
    throw new Error(`A sub-rede ${options.subnet} precisa ser /26 ou maior; encontrado ${subnet.ipCidrRange}.`);
  }
  const nat = (router.nats ?? []).find((item) => item.name === options.nat);
  if (!nat) throw new Error(`O Router ${options.router} não contém o NAT ${options.nat}.`);
  const covered = nat.sourceSubnetworkIpRangesToNat === 'ALL_SUBNETWORKS_ALL_IP_RANGES'
    || (nat.subnetworks ?? []).some((entry) => resourceEndsWith(
      entry.name, `/projects/${options.project}/regions/${options.region}/subnetworks/${options.subnet}`,
    ) && (entry.sourceIpRangesToNat ?? []).includes('ALL_IP_RANGES'));
  if (!covered) throw new Error(`O NAT ${options.nat} não cobre a sub-rede ${options.subnet}.`);
  if (address.address !== options.expectedIp) {
    throw new Error(`O IP reservado é ${address.address}; esperado ${options.expectedIp}.`);
  }
  const addressSuffix = `/projects/${options.project}/regions/${options.region}/addresses/${options.address}`;
  if (nat.natIpAllocateOption !== 'MANUAL_ONLY' || nat.natIps?.length !== 1
    || !resourceEndsWith(nat.natIps[0], addressSuffix)) {
    throw new Error(`O NAT ${options.nat} precisa usar somente ${options.address} com MANUAL_ONLY.`);
  }
  return nat;
}

export function assertActiveRecognizedNetwork(cloudFunction, connectorConfigured, directConfigured) {
  if (cloudFunction.state !== 'ACTIVE' || !connectorConfigured && !directConfigured) {
    throw new Error('A função precisa estar ACTIVE com conector ou Direct VPC esperado antes do PATCH.');
  }
}

export function assertConnectorReady(connector, options) {
  const name = `projects/${options.project}/locations/${options.region}/connectors/${options.connector}`;
  if (connector.name !== name || connector.state !== 'READY') {
    throw new Error(`O conector ${options.connector} precisa existir e estar READY.`);
  }
}

export function assertSchedulerTarget(scheduler, cloudFunction, options) {
  if (scheduler.state !== 'ENABLED') {
    throw new Error(`O Scheduler ${options.scheduler} precisa estar ENABLED.`);
  }
  const target = scheduler.httpTarget;
  const urls = [cloudFunction.url, cloudFunction.serviceConfig?.uri]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .map((value) => value.replace(/\/$/, ''));
  if (!target?.uri || !urls.includes(target.uri.replace(/\/$/, ''))) {
    throw new Error(`O Scheduler ${options.scheduler} não aponta para a função ${options.function}.`);
  }
  if (target.httpMethod !== 'POST' || !target.oidcToken
    || (target.oidcToken.audience || target.uri) !== target.uri) {
    throw new Error(`O Scheduler ${options.scheduler} precisa chamar a função por POST com audience correspondente.`);
  }
}
