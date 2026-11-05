/** A PKCE verifier and its S256 challenge (RFC 7636). */
export interface Pkce {
  verifier: string;
  challenge: string;
}

export async function createPkce(verifier = randomToken(32)): Promise<Pkce> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

/** A random base64url string, also used for the CSRF `state`. 32 bytes make a 43-character verifier. */
export function randomToken(byteCount = 24): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteCount)));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
