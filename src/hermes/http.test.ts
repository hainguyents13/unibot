import { describe, expect, it } from "vitest";
import { GatewayError } from "./gateway-error";
import { errorMessage, jsonRequest, sendJson, type HttpTransport } from "./http";

const answer =
  (status: number, body: string): HttpTransport =>
  async () => ({ status, body });

describe("sendJson", () => {
  it("parses a 2xx body", async () => {
    await expect(sendJson(answer(200, '{"ok":true}'), jsonRequest("https://x/api"))).resolves.toEqual({ ok: true });
  });

  it("turns other statuses into an http error carrying the gateway's words", async () => {
    const error = await sendJson(answer(403, '{"detail":"Not allowed"}'), jsonRequest("https://x/api")).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(GatewayError);
    expect(error).toMatchObject({ kind: "http", code: 403, detail: "Not allowed" });
  });

  it("calls a network failure unreachable", async () => {
    const failing: HttpTransport = async () => {
      throw new Error("connection refused");
    };
    await expect(sendJson(failing, jsonRequest("https://x/api"))).rejects.toMatchObject({
      kind: "unreachable",
      detail: "connection refused",
    });
  });

  it("calls a body that isn't JSON an invalid response", async () => {
    await expect(sendJson(answer(200, "<html>"), jsonRequest("https://x/api"))).rejects.toMatchObject({
      kind: "invalidResponse",
    });
  });
});

describe("jsonRequest", () => {
  it("sends JSON with the bearer token", () => {
    const request = jsonRequest("https://x/api", { method: "POST", body: { a: 1 }, bearer: "tok" });
    expect(request).toMatchObject({
      method: "POST",
      body: '{"a":1}',
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
    });
  });
});

describe("errorMessage", () => {
  it.each([
    ['{"detail":"Bad"}', "Bad"],
    ['{"detail":{"error":"Saved but not scheduled"}}', "Saved but not scheduled"],
    ['{"error":"invalid_grant"}', "invalid_grant"],
    ['{"detail":[{"msg":"x"}]}', undefined],
    ["not json", undefined],
  ])("reads %s", (body, expected) => {
    expect(errorMessage(body)).toBe(expected);
  });
});
