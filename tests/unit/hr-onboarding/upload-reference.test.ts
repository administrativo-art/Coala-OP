import assert from 'node:assert/strict';
import test from 'node:test';
import { validateOnboardingUploadReference } from '../../../src/lib/hr/onboarding-upload-reference';
const bucket = 'demo-storage.appspot.com', token = 'safe-onboarding-token';
const path = `hr/onboarding/${token}/upload.pdf`;
const url = (file: string, targetBucket = bucket) => `https://firebasestorage.googleapis.com/v0/b/${targetBucket}/o/${encodeURIComponent(file)}?alt=media&token=synthetic`;

test('public upload reference binds the URL and path to the exact project and process', () => {
  assert.equal(validateOnboardingUploadReference({ bucket, token, fileUrl: url(path), filePath: path }).filePath, path);
  assert.equal(validateOnboardingUploadReference({ bucket, token, fileUrl: url(path), existingPath: path }).filePath, path);
  for (const [filePath, fileUrl] of [
    ['private/payments/proof.pdf', url('private/payments/proof.pdf')],
    ['hr/onboarding/other-token/upload.pdf', url('hr/onboarding/other-token/upload.pdf')],
    [path, url(path, 'other-project.appspot.com')],
    [path, url(path).replace('/v0/', '/anything/../v0/')],
    [path, url(path).replace('/v0/', '/anything/%2e%2e/v0/')],
    [path, url(path + '.different')],
    [path, 'https://firebasestorage.googleapis.com.evil.test/v0/b/x/o/x'],
    [`hr/onboarding/${token}/../secret.pdf`, url(`hr/onboarding/${token}/../secret.pdf`)],
    [`hr/onboarding/${token}/%2e%2e`, url(`hr/onboarding/${token}/%2e%2e`)],
    [`hr/onboarding/${token}/bad\\file.pdf`, url(`hr/onboarding/${token}/bad\\file.pdf`)],
  ]) assert.throws(() => validateOnboardingUploadReference({ bucket, token, filePath, fileUrl }), { code: 'ONBOARDING_DOCUMENT_REFERENCE_INVALID' });
  assert.throws(() => validateOnboardingUploadReference({ bucket, token, existingPath: 'private/payment.pdf', fileUrl: url(path) }));
});
