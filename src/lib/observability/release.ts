type ReleaseEnvironment = Record<string, string | undefined>;

export function resolveRuntimeEnvironment(env: ReleaseEnvironment = process.env) {
  return env.NODE_ENV?.trim() || "unknown";
}

export function resolveRuntimeRelease(env: ReleaseEnvironment = process.env) {
  return env.K_REVISION?.trim() || env.GITHUB_SHA?.trim() || "unknown";
}
