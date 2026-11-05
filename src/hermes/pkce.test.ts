import { describe, expect, it } from "vitest";
import { createPkce, randomToken } from "./pkce";

describe("PKCE", () => {
  it("matches the S256 example in RFC 7636 appendix B", async () => {
    const pkce = await createPkce("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    expect(pkce.challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("makes a 43-character base64url verifier by default", async () => {
    const { verifier } = await createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("never repeats a state", () => {
    expect(randomToken()).not.toBe(randomToken());
  });
});
