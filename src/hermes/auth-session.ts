import type { GatewayAddress } from "./gateway-address";
import { GatewayError, isGatewayError } from "./gateway-error";
import { jsonRequest, sendJson, type HttpTransport } from "./http";

/**
 * The bearer tokens a gateway issues after browser sign-in. The access token lasts about
 * 15 minutes; the refresh token rotates on every use.
 */
export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
  provider: string;
  userId: string;
}

/** The body of `/auth/native/token` and `/auth/native/refresh`. */
export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  /** Unix seconds. */
  expires_at: number;
  provider?: string | null;
  user_id?: string | null;
}

export function tokenSetFrom(response: TokenResponse): TokenSet {
  if (typeof response?.access_token !== "string" || typeof response.refresh_token !== "string") {
    throw new GatewayError("invalidResponse");
  }
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: Number(response.expires_at) * 1000,
    provider: response.provider ?? "",
    userId: response.user_id ?? "",
  };
}

/**
 * What survives a relaunch. Only the refresh side is kept: the access token is short-lived and a
 * restored session refreshes before its first request anyway, and Credential Manager caps a
 * credential at 2,560 bytes.
 */
export interface SavedSignIn {
  refreshToken: string;
  provider: string;
  userId: string;
}

/** Where a gateway's sign-in is kept between launches. */
export interface TokenStore {
  load(gateway: GatewayAddress): Promise<SavedSignIn | undefined>;
  save(gateway: GatewayAddress, signIn: SavedSignIn): Promise<void>;
  delete(gateway: GatewayAddress): Promise<void>;
}

export function savedSignIn(tokens: TokenSet): SavedSignIn {
  return { refreshToken: tokens.refreshToken, provider: tokens.provider, userId: tokens.userId };
}

/** Tokens for a restored sign-in: no access token yet, so the first request refreshes. */
export function restoredTokens(saved: SavedSignIn): TokenSet {
  return { ...saved, accessToken: "", expiresAt: 0 };
}

/** Refresh this long before the access token expires. */
const REFRESH_MARGIN_MS = 60_000;

/**
 * Holds one gateway's tokens and keeps the access token fresh.
 *
 * Refresh tokens rotate and the gateway revokes the whole session when an old one is reused, so
 * at most one refresh runs at a time and every rotation is saved before the new pair is used.
 */
export class AuthSession {
  private refreshing: Promise<TokenSet> | undefined;

  constructor(
    readonly gateway: GatewayAddress,
    private tokens: TokenSet,
    private readonly store: TokenStore,
    private readonly http: HttpTransport,
    private readonly now: () => number = Date.now,
  ) {}

  get userId(): string {
    return this.tokens.userId;
  }

  /** A valid access token, refreshing first when it is about to expire. */
  async accessToken(): Promise<string> {
    if (this.tokens.expiresAt - this.now() <= REFRESH_MARGIN_MS) return (await this.refresh()).accessToken;
    return this.tokens.accessToken;
  }

  /** Sends a JSON request with the bearer token. A 401 triggers one refresh and one retry. */
  async json<T>(path: string, options: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
    const request = (bearer: string) => jsonRequest(this.gateway.url(path), { ...options, bearer });
    try {
      return await sendJson<T>(this.http, request(await this.accessToken()));
    } catch (error) {
      if (!isGatewayError(error, "http") || error.code !== 401) throw error;
      return sendJson<T>(this.http, request((await this.refresh()).accessToken));
    }
  }

  /** A single-use, 30-second ticket for opening the JSON-RPC socket. */
  async webSocketTicket(): Promise<string> {
    const { ticket } = await this.json<{ ticket: string }>("/api/auth/ws-ticket", { method: "POST" });
    if (typeof ticket !== "string") throw new GatewayError("invalidResponse");
    return ticket;
  }

  /** Rotates the tokens. Concurrent callers share one request. */
  refresh(): Promise<TokenSet> {
    this.refreshing ??= this.performRefresh().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async performRefresh(): Promise<TokenSet> {
    const request = jsonRequest(this.gateway.url("/auth/native/refresh"), {
      method: "POST",
      body: { refresh_token: this.tokens.refreshToken, provider: this.tokens.provider },
    });
    let fresh: TokenSet;
    try {
      fresh = tokenSetFrom(await sendJson<TokenResponse>(this.http, request));
    } catch (error) {
      if (isGatewayError(error, "http") && error.code === 401) {
        // The refresh token is spent or revoked: nothing left to retry with.
        await this.store.delete(this.gateway).catch(() => {});
        throw new GatewayError("signInRequired");
      }
      throw error;
    }
    this.tokens = fresh;
    // Saved before anyone uses the new pair, so a relaunch never replays the spent token.
    await this.store.save(this.gateway, savedSignIn(fresh)).catch(() => {});
    return fresh;
  }

  /** Forgets the sign-in on this computer. */
  async signOut(): Promise<void> {
    await this.store.delete(this.gateway);
  }
}
