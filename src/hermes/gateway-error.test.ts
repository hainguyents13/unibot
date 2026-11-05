import { describe, expect, it } from "vitest";
import { AddressError, GatewayAddress } from "./gateway-address";
import { describeError, GatewayError } from "./gateway-error";

describe("describeError", () => {
  const unreachable = new GatewayError("unreachable", "error sending request for url (http://x)");

  it("names the gateway it can't reach, without the network library's wording", () => {
    const text = describeError(unreachable, GatewayAddress.parse("192.168.1.20:9119"));
    expect(text).toBe("Can't reach 192.168.1.20:9119. Check the address, and that hermes dashboard is running there.");
  });

  it("points at Tailscale for a tailnet address", () => {
    expect(describeError(unreachable, GatewayAddress.parse("100.101.102.103:9119"))).toContain("check that Tailscale is on");
  });

  it("explains address problems", () => {
    expect(describeError(new AddressError("empty"))).toBe("Enter your gateway's address.");
    expect(describeError(new AddressError("insecureHttp", "hermes.example.com"))).toContain("use https://");
  });

  it("shows the gateway's message for an http error", () => {
    expect(describeError(new GatewayError("http", "Not allowed", 403))).toBe("Not allowed (HTTP 403)");
  });
});
