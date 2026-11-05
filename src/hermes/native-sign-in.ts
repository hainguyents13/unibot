import { tokenSetFrom, type TokenResponse, type TokenSet } from "./auth-session";
import type { GatewayAddress } from "./gateway-address";
import { GatewayError } from "./gateway-error";
import { jsonRequest, sendJson, type HttpTransport } from "./http";
import { createPkce, randomToken } from "./pkce";

/** The redirect listener on `127.0.0.1`, which lives in the Rust side of the app. */
export interface Loopback {
  /** Starts listening and returns the port. */
  start(): Promise<number>;
  /** The redirect's query string. Rejects with `timedOut` or `cancelled`. */
  wait(timeoutSeconds: number): Promise<string>;
  cancel(): Promise<void>;
}

export interface SignInDeps {
  http: HttpTransport;
  loopback: Loopback;
  /** Opens the gateway's sign-in page in the default browser. */
  openUrl(url: string): Promise<void>;
}

/** The `GET /api/status` fields that pick a sign-in flow. */
export interface GatewayStatus {
  version?: string;
  auth_required?: boolean;
  auth_flows?: string[];
}

export function fetchStatus(gateway: GatewayAddress, http: HttpTransport): Promise<GatewayStatus> {
  return sendJson<GatewayStatus>(http, jsonRequest(gateway.url("/api/status")));
}

/** System browser + loopback redirect + PKCE (RFC 8252), the flow this app uses. */
export function supportsNativeSignIn(status: GatewayStatus): boolean {
  return Array.isArray(status.auth_flows) && status.auth_flows.includes("native_pkce");
}

const SIGN_IN_TIMEOUT_SECONDS = 600;

/**
 * Browser sign-in to a gated gateway (RFC 8252): the gateway brokers the identity provider and
 * returns a one-time code to a loopback redirect; the app redeems it with its PKCE verifier.
 */
export async function signInWithBrowser(gateway: GatewayAddress, deps: SignInDeps): Promise<TokenSet> {
  const pkce = await createPkce();
  const state = randomToken();
  const port = await deps.loopback.start();
  try {
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    await deps.openUrl(authorizeUrl(gateway, pkce.challenge, redirectUri, state));
    let query: string;
    try {
      query = await deps.loopback.wait(SIGN_IN_TIMEOUT_SECONDS);
    } catch (error) {
      const reason = String(error);
      throw new GatewayError(reason === "timedOut" ? "timedOut" : reason === "cancelled" ? "cancelled" : "signInFailed", reason);
    }
    const code = codeFromCallback(query, state);
    return await redeem(gateway, code, pkce.verifier, deps.http);
  } finally {
    await deps.loopback.cancel().catch(() => {});
  }
}

/**
 * `/auth/native/authorize` takes no client ID or scope; the gateway picks its only provider, or
 * shows a chooser when it has several.
 */
export function authorizeUrl(gateway: GatewayAddress, challenge: string, redirectUri: string, state: string): string {
  const query = new URLSearchParams({
    code_challenge: challenge,
    code_challenge_method: "S256",
    redirect_uri: redirectUri,
    state,
  });
  return `${gateway.url("/auth/native/authorize")}?${query}`;
}

/** The redirect must echo our `state` (CSRF protection) and carry a code. */
export function codeFromCallback(query: string, expectedState: string): string {
  const params = new URLSearchParams(query);
  const error = params.get("error");
  if (error) throw new GatewayError("signInFailed", error);
  if (params.get("state") !== expectedState) {
    throw new GatewayError("signInFailed", "the browser returned an unexpected response");
  }
  const code = params.get("code");
  if (!code) throw new GatewayError("signInFailed", "the gateway didn't return a code");
  return code;
}

async function redeem(gateway: GatewayAddress, code: string, verifier: string, http: HttpTransport): Promise<TokenSet> {
  const request = jsonRequest(gateway.url("/auth/native/token"), {
    method: "POST",
    body: { code, code_verifier: verifier },
  });
  return tokenSetFrom(await sendJson<TokenResponse>(http, request));
}
