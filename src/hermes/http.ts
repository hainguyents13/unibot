import { GatewayError } from "./gateway-error";

export interface HttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

export interface HttpResponse {
  status: number;
  body: string;
}

/**
 * Sends one HTTP request. Rejects only when the request never got an answer (network failure,
 * timeout); any status resolves. The app goes through Tauri's HTTP plugin; tests use a fake.
 */
export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;

export function jsonRequest(
  url: string,
  options: { method?: string; body?: unknown; bearer?: string; timeoutMs?: number } = {},
): HttpRequest {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.bearer) headers.Authorization = `Bearer ${options.bearer}`;
  return {
    url,
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    timeoutMs: options.timeoutMs ?? 30_000,
  };
}

/** Sends `request` and parses a 2xx JSON body. Other statuses throw `http` with the gateway's message. */
export async function sendJson<T>(http: HttpTransport, request: HttpRequest): Promise<T> {
  const body = await sendForBody(http, request);
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new GatewayError("invalidResponse");
  }
}

/** Sends `request` and returns a 2xx body as it came, with the same errors as `sendJson`. */
export async function sendForBody(http: HttpTransport, request: HttpRequest): Promise<string> {
  let response: HttpResponse;
  try {
    response = await http(request);
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    throw new GatewayError("unreachable", error instanceof Error ? error.message : String(error));
  }
  if (response.status < 200 || response.status >= 300) {
    throw new GatewayError("http", errorMessage(response.body), response.status);
  }
  return response.body;
}

/**
 * FastAPI errors carry `{"detail": "..."}`; the auth routes use `{"error": "..."}`. Some details
 * are objects with their own `error`.
 */
export function errorMessage(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const detail = parsed.detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object" && typeof (detail as { error?: unknown }).error === "string") {
      return (detail as { error: string }).error;
    }
    return typeof parsed.error === "string" ? parsed.error : undefined;
  } catch {
    return undefined;
  }
}
