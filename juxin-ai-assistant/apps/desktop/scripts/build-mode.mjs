export const BUILD_MODES = Object.freeze([
  "development",
  "lan-test",
  "production",
]);

export function parseBuildMode(raw) {
  if (BUILD_MODES.includes(raw)) return raw;
  throw new Error(`Invalid AI assistant build mode: ${String(raw)}`);
}

function parseStrictIpv4(hostname) {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return Number.NaN;
    return Number(part);
  });
  return octets.every((octet) => Number.isInteger(octet) && octet <= 255)
    ? octets
    : null;
}

function isPrivateHttpHost(hostname) {
  if (hostname.toLowerCase() === "localhost" || hostname === "[::1]") {
    return true;
  }
  const octets = parseStrictIpv4(hostname);
  if (!octets) return false;
  return (
    octets[0] === 127 ||
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function parseSafeUrl(raw) {
  if (typeof raw !== "string" || raw.trim() !== raw || raw.includes("*")) {
    throw new Error("URL contains unsafe characters");
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("URL is invalid");
  }
  if (
    !url.hostname ||
    url.username ||
    url.password ||
    url.hash ||
    rawAuthorityHasUserinfo(raw)
  ) {
    throw new Error("URL contains unsafe components");
  }
  return url;
}

function assertTrustedScheme(raw, url, mode) {
  if (url.protocol === "https:") return;
  if (
    url.protocol === "http:" &&
    mode !== "production" &&
    isCanonicalPrivateHttpHost(raw, url.hostname)
  ) {
    return;
  }
  throw new Error(
    mode === "production"
      ? "Production URLs must use HTTPS"
      : "HTTP URLs must use localhost or a private IPv4 address",
  );
}

function isCanonicalPrivateHttpHost(raw, normalizedHostname) {
  const hostname = rawAuthorityHostname(raw);
  if (
    hostname.toLowerCase() === "localhost" ||
    hostname.toLowerCase() === "[::1]"
  ) {
    return true;
  }
  return hostname === normalizedHostname && isPrivateHttpHost(hostname);
}

function rawAuthorityHostname(raw) {
  const authority = (raw.split("://", 2)[1] ?? "").split(/[/?#]/, 1)[0];
  if (authority.startsWith("[")) {
    const closingBracket = authority.indexOf("]");
    return closingBracket === -1 ? authority : authority.slice(0, closingBracket + 1);
  }
  const portSeparator = authority.lastIndexOf(":");
  return portSeparator === -1 ? authority : authority.slice(0, portSeparator);
}

function rawAuthorityHasUserinfo(raw) {
  const remainder = raw.split("://", 2)[1] ?? "";
  return remainder.split(/[/?#]/, 1)[0].includes("@");
}

export function validateBusinessOrigin(raw, rawMode) {
  const mode = parseBuildMode(rawMode);
  const url = parseSafeUrl(raw);
  assertTrustedScheme(raw, url, mode);
  if (url.pathname !== "/" || url.search || !rawOriginPathIsEmpty(raw)) {
    throw new Error("Business server URL must be an exact origin");
  }
  return url.origin;
}

function rawOriginPathIsEmpty(raw) {
  const remainder = raw.split("://", 2)[1] ?? "";
  const componentIndex = remainder.search(/[/?#]/);
  return componentIndex === -1 || remainder.slice(componentIndex) === "/";
}

export function validateUpdateEndpoint(raw, rawMode) {
  const mode = parseBuildMode(rawMode);
  const url = parseSafeUrl(raw);
  assertTrustedScheme(raw, url, mode);
  if (!url.pathname || url.pathname === "/" || url.search) {
    throw new Error("Update endpoint must include an exact file path");
  }
  return raw;
}
