import { describe, expect, it } from "vitest";
import { GatewayAddress } from "./gateway-address";
import { authorizeUrl, codeFromCallback, signInWithBrowser, supportsNativeSignIn, type Loopback } from "./native-sign-in";
import { fakeHttp, json, tokenResponse } from "./test-support";

const gateway = GatewayAddress.parse("100.101.102.103:9119");

describe("signInWithBrowser", () => {
  it("opens the authorize page, catches the redirect and redeems the code with the verifier", async () => {
    const { http, requests } = fakeHttp({ "POST /auth/native/token": () => json(200, tokenResponse(1)) });
    let opened = "";
    let cancelled = false;
    const loopback: Loopback = {
      start: async () => 51234,
      wait: async () => {
        const state = new URL(opened).searchParams.get("state");
        return `code=the-code&state=${state}`;
      },
      cancel: async () => {
        cancelled = true;
      },
    };

    const tokens = await signInWithBrowser(gateway, {
      http,
      loopback,
      openUrl: async (url) => {
        opened = url;
      },
    });

    const authorize = new URL(opened);
    expect(authorize.origin + authorize.pathname).toBe("http://100.101.102.103:9119/auth/native/authorize");
    expect(authorize.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:51234/callback");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    const body = JSON.parse(requests[0].body!);
    expect(body.code).toBe("the-code");
    expect(body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokens.accessToken).toBe("access-1");
    expect(cancelled).toBe(true);
  });

  it("reports a closed browser as cancelled and stops listening", async () => {
    let cancelled = false;
    const loopback: Loopback = {
      start: async () => 1,
      wait: async () => {
        throw "cancelled";
      },
      cancel: async () => {
        cancelled = true;
      },
    };
    await expect(
      signInWithBrowser(gateway, { http: fakeHttp({}).http, loopback, openUrl: async () => {} }),
    ).rejects.toMatchObject({ kind: "cancelled" });
    expect(cancelled).toBe(true);
  });
});

describe("codeFromCallback", () => {
  it("returns the code when the state matches", () => {
    expect(codeFromCallback("code=c&state=s", "s")).toBe("c");
  });

  it.each([
    ["error=access_denied&state=s", "access_denied"],
    ["code=c&state=other", "the browser returned an unexpected response"],
    ["state=s", "the gateway didn't return a code"],
  ])("refuses %s", (query, detail) => {
    expect(() => codeFromCallback(query, "s")).toThrow(expect.objectContaining({ kind: "signInFailed", detail }));
  });
});

describe("authorizeUrl", () => {
  it("keeps a reverse proxy's path prefix", () => {
    const url = authorizeUrl(GatewayAddress.parse("https://hermes.example.com/hermes"), "ch", "http://127.0.0.1:1/callback", "st");
    expect(url.startsWith("https://hermes.example.com/hermes/auth/native/authorize?")).toBe(true);
  });
});

describe("supportsNativeSignIn", () => {
  it("needs native_pkce among the auth flows", () => {
    expect(supportsNativeSignIn({ auth_flows: ["password", "native_pkce"] })).toBe(true);
    expect(supportsNativeSignIn({ auth_flows: ["password"] })).toBe(false);
    expect(supportsNativeSignIn({})).toBe(false);
  });
});
