import { z } from 'zod';

import { COALA_APP_INSTALLERS } from './signage';
import { MOBILE_GO_PACKAGE, mobilePackageSchema } from './security/mobile-app-attestation';

export const mobileReleaseQuerySchema = z.object({ packageName: mobilePackageSchema.optional() }).strict();

// Metadata and APK are prepared together locally. Deployment still requires
// separate authorization; these values describe the repository artifact.
export const COALA_GO_RELEASE = { versionCode: 33, versionName: '0.3.28', minVersionCode: 33 } as const;
export const COALA_GO_APK_SHA256 = '88477ee0bb3c12873efb9b19ab15e237d5306c3e5ea216176b66f174af131dfe';

export function mobileReleaseForPackage(packageName: unknown = MOBILE_GO_PACKAGE) {
  const selected = mobilePackageSchema.parse(packageName);
  return selected === MOBILE_GO_PACKAGE
    ? { ...COALA_GO_RELEASE, packagePath: COALA_APP_INSTALLERS.mobile.packagePath }
    // The source/installer was explicitly retired. Never give a legacy package
    // the Go APK: package identity is not interchangeable.
    : { versionCode: 3, versionName: '0.1.2', minVersionCode: 1, packagePath: null };
}
