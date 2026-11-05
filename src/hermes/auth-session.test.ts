import { describe, expect, it } from "vitest";
import { AuthSession, restoredTokens, type TokenSet } from "./auth-session";
import { GatewayAddress } from "./gateway-address";
import { fakeHttp, json, MemoryTokenStore, tokenResponse } from "./test-support";

const gateway = GatewayAddress.parse("100.101.102.103:9119");
const now = 1_800_000_000_000;

function fresh(expiresInMs = 10 * 60_000): TokenSet {
  return { accessToken: "access-0", refreshToken: "refresh-0", expiresAt: now + expiresInMs, provider: "password", userId: "u" };
}

describe("AuthSession", () => {
  it("uses the access token while it is fresh", async () => {
    const { http, requests } = fakeHttp({ "GET /api/thing": () => json(200, { ok: true }) });
    const auth = new AuthSession(gateway, fresh(), new MemoryTokenStore(), http, () => now);
    await expect(auth.json("/api/thing")).resolves.toEqual({ ok: true });
    expect(requests[0].headers.Authorization).toBe("Bearer access-0");
  });

  it("refreshes a restored sign-in before its first request, and saves the rotation", async () => {
    let refreshes = 0;
    const { http, requests } = fakeHttp({
      "POST /auth/native/refresh": () => json(200, tokenResponse(++refreshes, 900, now)),
      "POST /api/auth/ws-ticket": () => json(200, { ticket: "t-1" }),
    });
    const store = new MemoryTokenStore();
    const auth = new AuthSession(
      gateway,
      restoredTokens({ refreshToken: "refresh-0", provider: "password", userId: "u" }),
      store,
      http,
      () => now,
    );

    await expect(auth.webSocketTicket()).resolves.toBe("t-1");
    expect(JSON.parse(requests[0].body!)).toEqual({ refresh_token: "refresh-0", provider: "password" });
    expect(requests[1].headers.Authorization).toBe("Bearer access-1");
    expect(store.saved.get(gateway.baseUrl)).toEqual({ refreshToken: "refresh-1", provider: "password", userId: "user-1" });
  });

  it("shares one refresh between concurrent callers, so a rotated token is never replayed", async () => {
    let refreshes = 0;
    const { http } = fakeHttp({
      "POST /auth/native/refresh": async () => json(200, tokenResponse(++refreshes, 900, now)),
      "GET /api/a": () => json(200, {}),
    });
    const auth = new AuthSession(gateway, fresh(30_000), new MemoryTokenStore(), http, () => now);
    await Promise.all([auth.json("/api/a"), auth.json("/api/a"), auth.json("/api/a")]);
    expect(refreshes).toBe(1);
  });

  it("refreshes once and retries when a request comes back 401", async () => {
    let calls = 0;
    const { http, requests } = fakeHttp({
      "POST /auth/native/refresh": () => json(200, tokenResponse(1, 900, now)),
      "GET /api/a": () => (++calls === 1 ? json(401, { detail: "expired" }) : json(200, { ok: 1 })),
    });
    const auth = new AuthSession(gateway, fresh(), new MemoryTokenStore(), http, () => now);
    await expect(auth.json("/api/a")).resolves.toEqual({ ok: 1 });
    expect(requests.at(-1)!.headers.Authorization).toBe("Bearer access-1");
  });

  it("asks to sign in again and forgets the sign-in when the refresh token is rejected", async () => {
    const { http } = fakeHttp({ "POST /auth/native/refresh": () => json(401, { error: "invalid_grant" }) });
    const store = new MemoryTokenStore();
    await store.save(gateway, { refreshToken: "refresh-0", provider: "password", userId: "u" });
    const auth = new AuthSession(gateway, fresh(0), store, http, () => now);
    await expect(auth.accessToken()).rejects.toMatchObject({ kind: "signInRequired" });
    expect(store.saved.size).toBe(0);
  });
});
