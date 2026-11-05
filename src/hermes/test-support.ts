import type { GatewayAddress } from "./gateway-address";
import type { HttpRequest, HttpResponse, HttpTransport } from "./http";
import type { SavedSignIn, TokenStore } from "./auth-session";

/** An HTTP fake that answers each request with the first matching route, and records requests. */
export function fakeHttp(routes: Record<string, (request: HttpRequest) => HttpResponse | Promise<HttpResponse>>) {
  const requests: HttpRequest[] = [];
  const http: HttpTransport = async (request) => {
    requests.push(request);
    const path = new URL(request.url).pathname;
    const route = routes[`${request.method} ${path}`];
    if (!route) return { status: 404, body: '{"detail":"Not Found"}' };
    return route(request);
  };
  return { http, requests };
}

export function json(status: number, body: unknown): HttpResponse {
  return { status, body: JSON.stringify(body) };
}

export class MemoryTokenStore implements TokenStore {
  readonly saved = new Map<string, SavedSignIn>();

  async load(gateway: GatewayAddress) {
    return this.saved.get(gateway.baseUrl);
  }

  async save(gateway: GatewayAddress, signIn: SavedSignIn) {
    this.saved.set(gateway.baseUrl, signIn);
  }

  async delete(gateway: GatewayAddress) {
    this.saved.delete(gateway.baseUrl);
  }
}

export function tokenResponse(n: number, expiresInSeconds = 900, nowMs = Date.now()) {
  return {
    access_token: `access-${n}`,
    refresh_token: `refresh-${n}`,
    expires_at: nowMs / 1000 + expiresInSeconds,
    provider: "password",
    user_id: "user-1",
  };
}
