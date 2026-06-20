import { basename } from "node:path";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SECRET_FIELD_PATTERN = /(secret|token|password|private.?key|credential)/i;

function assertNoSecretFields(value, path = "manifest") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretFields(entry, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_FIELD_PATTERN.test(key)) {
      throw new Error(`secret-like field is forbidden: ${path}.${key}`);
    }
    assertNoSecretFields(entry, `${path}.${key}`);
  }
}

export function resolveUpdatePolicy(input) {
  if (input.enabled !== true) {
    return { enabled: false, mayRequestUpdates: false };
  }
  const endpointIsSecure = typeof input.endpoint === "string"
    && input.endpoint.startsWith("https://");
  const hasPublicKey = typeof input.publicKey === "string" && input.publicKey.trim().length > 0;
  if (!endpointIsSecure || !hasPublicKey) {
    throw new Error("enabled updater requires an HTTPS endpoint and public key");
  }
  return {
    enabled: true,
    mayRequestUpdates: true,
    endpoint: input.endpoint,
    publicKey: input.publicKey,
  };
}

export function validateArtifactManifest(manifest, { expectedVersion, expectedPlatformVersion } = {}) {
  assertNoSecretFields(manifest);
  if (expectedVersion !== undefined && manifest.version !== expectedVersion) {
    throw new Error(`manifest version must be ${expectedVersion}`);
  }
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+/.test(manifest.version)) {
    throw new Error("manifest version must be semantic versioning");
  }
  if (expectedPlatformVersion !== undefined && manifest.platformVersion !== expectedPlatformVersion) {
    throw new Error(`manifest platform version must be ${expectedPlatformVersion}`);
  }
  if (typeof manifest.platformVersion !== "string" || !/^\d+\.\d+\.\d+/.test(manifest.platformVersion)) {
    throw new Error("manifest platform version must be semantic versioning");
  }
  if (!Array.isArray(manifest.artifacts)) {
    throw new Error("manifest artifacts must be an array");
  }
  for (const artifact of manifest.artifacts) {
    if (!SHA256_PATTERN.test(artifact.sha256 ?? "")) {
      throw new Error(`artifact ${artifact.file ?? "<unknown>"} requires a lowercase SHA256 checksum`);
    }
    if (!SHA256_PATTERN.test(artifact.architectureSha256 ?? "")) {
      throw new Error(`artifact ${artifact.file ?? "<unknown>"} requires architecture SHA256 evidence`);
    }
    if (artifact.file !== basename(artifact.file)) {
      throw new Error("artifact filename must not contain a path");
    }
    if (artifact.architectureFile !== basename(artifact.architectureFile ?? "")) {
      throw new Error("architecture evidence filename must not contain a path");
    }
    if (!artifact.file.includes(`_${manifest.version}_`)) {
      throw new Error(`artifact filename must include version ${manifest.version}`);
    }
    if (artifact.platform === "macos") {
      if (artifact.arch !== "arm64" || !artifact.file.includes("aarch64")) {
        throw new Error("macOS artifacts must be arm64/aarch64 only");
      }
      if (!artifact.file.endsWith(".dmg")) {
        throw new Error("unexpected macOS artifact extension");
      }
      continue;
    }
    if (artifact.platform === "windows") {
      if (artifact.arch !== "x64" || !artifact.file.includes("x64")) {
        throw new Error("Windows artifacts must be x64 only");
      }
      if (!artifact.file.endsWith(".exe") && !artifact.file.endsWith(".msi")) {
        throw new Error("unexpected Windows artifact extension");
      }
      continue;
    }
    throw new Error(`unsupported artifact platform: ${artifact.platform}`);
  }
}
