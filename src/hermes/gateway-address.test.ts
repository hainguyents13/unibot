import { describe, expect, it } from "vitest";
import { AddressError, GatewayAddress } from "./gateway-address";

function problem(input: string) {
  try {
    GatewayAddress.parse(input);
  } catch (error) {
    return (error as AddressError).problem;
  }
  return undefined;
}

describe("GatewayAddress.parse", () => {
  it.each([
    ["100.101.102.103:9119", "http://100.101.102.103:9119"],
    ["  http://100.101.102.103:9119/  ", "http://100.101.102.103:9119"],
    ["hermes.example.com", "https://hermes.example.com"],
    ["https://hermes.example.com/hermes/", "https://hermes.example.com/hermes"],
    ["my-vps.tail1234.ts.net:9119", "https://my-vps.tail1234.ts.net:9119"],
    ["http://192.168.1.20:9119", "http://192.168.1.20:9119"],
    ["vps:9119", "http://vps:9119"],
    ["http://[fd7a:115c:a1e0::1]:9119", "http://[fd7a:115c:a1e0::1]:9119"],
  ])("reads %s as %s", (input, expected) => {
    expect(GatewayAddress.parse(input).baseUrl).toBe(expected);
  });

  it("refuses plain http to a public host, which would send the sign-in unencrypted", () => {
    expect(problem("http://hermes.example.com")).toBe("insecureHttp");
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["ftp://hermes.example.com", "invalid"],
    ["https://user:pass@hermes.example.com", "invalid"],
    ["https://hermes.example.com/?x=1", "invalid"],
    ["https://hermes.example.com/#top", "invalid"],
  ])("rejects %j as %s", (input, expected) => {
    expect(problem(input)).toBe(expected);
  });
});

describe("GatewayAddress", () => {
  it("builds endpoint and socket URLs, keeping the path prefix", () => {
    const gateway = GatewayAddress.parse("https://hermes.example.com/hermes");
    expect(gateway.url("/api/status")).toBe("https://hermes.example.com/hermes/api/status");
    expect(gateway.webSocketUrl("a b")).toBe("wss://hermes.example.com/hermes/api/ws?ticket=a%20b");
    expect(GatewayAddress.parse("100.101.102.103:9119").webSocketUrl("t")).toBe(
      "ws://100.101.102.103:9119/api/ws?ticket=t",
    );
  });

  it("shows host and port", () => {
    expect(GatewayAddress.parse("100.101.102.103:9119").displayName).toBe("100.101.102.103:9119");
    expect(GatewayAddress.parse("hermes.example.com").displayName).toBe("hermes.example.com");
  });

  it.each([
    ["100.101.102.103:9119", true],
    ["my-vps.tail1234.ts.net", true],
    ["http://[fd7a:115c:a1e0::1]:9119", true],
    ["192.168.1.20", false],
    ["hermes.example.com", false],
  ])("knows %s is a tailnet address: %s", (input, expected) => {
    expect(GatewayAddress.parse(input).isTailnet).toBe(expected);
  });
});
