import { generateKeyPairSync, sign } from 'node:crypto';

import { der, tlv } from '../../src/features/dp/rep-p/der';

/**
 * Gera em memória um certificado autoassinado no formato do e-CNPJ (otherName 2.16.76.1.3.3).
 * Serve só para testar a montagem CMS/PAdES; não é ICP-Brasil nem tem valor jurídico.
 */
export function createTestIcpCredential(options: { cnpj?: string; notBefore?: Date; notAfter?: Date } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const name = der.sequence(der.set(der.sequence(der.oid('2.5.4.3'), tlv(0x0c, Buffer.from(`EMPRESA TESTE:${options.cnpj ?? '14276603000125'}`)))));
  const algorithm = der.sequence(der.oid('1.2.840.113549.1.1.11'), der.null());
  const san = der.sequence(der.explicit(0, der.oid('2.16.76.1.3.3'),
    der.explicit(0, der.octetString(Buffer.from(options.cnpj ?? '14276603000125')))));
  const tbs = der.sequence(
    der.explicit(0, der.integer(2)), der.integer(Buffer.from('0102030405', 'hex')), algorithm, name,
    der.sequence(der.utcTime(options.notBefore ?? new Date('2026-01-01T00:00:00Z')),
      der.utcTime(options.notAfter ?? new Date('2030-01-01T00:00:00Z'))),
    name, publicKey.export({ type: 'spki', format: 'der' }),
    der.explicit(3, der.sequence(der.sequence(der.oid('2.5.29.17'), der.octetString(san)))),
  );
  const certificate = der.sequence(tbs, algorithm, tlv(0x03, Buffer.from([0]), sign('sha256', tbs, privateKey)));
  const certificatePem = `-----BEGIN CERTIFICATE-----\n${certificate.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
  return { pem: `${privateKey.export({ type: 'pkcs8', format: 'pem' })}${certificatePem}` };
}
