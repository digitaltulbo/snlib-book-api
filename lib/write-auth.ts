type HeaderValue = string | string[] | undefined;
type HeadersLike = Record<string, HeaderValue> | undefined;

function getHeader(headers: HeadersLike, name: string) {
  if (!headers) return undefined;
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === expected) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

function readToken(headers: HeadersLike) {
  const authorization = getHeader(headers, "authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice("Bearer ".length).trim();
  const direct = getHeader(headers, "x-write-token");
  return direct?.trim();
}

export function verifyWriteAuth(headers: HeadersLike) {
  const expected = process.env.HISTORY_WRITE_TOKEN;
  if (!expected) return { ok: false as const, error: "WRITE_AUTH_NOT_CONFIGURED", status: 500 };
  const actual = readToken(headers);
  if (!actual || actual !== expected) return { ok: false as const, error: "UNAUTHORIZED", status: 401 };
  return { ok: true as const };
}
