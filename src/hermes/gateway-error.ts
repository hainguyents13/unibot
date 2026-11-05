import { AddressError, type GatewayAddress } from "./gateway-address";

export type GatewayErrorKind =
  | "unreachable"
  | "http"
  | "invalidResponse"
  /** The gateway doesn't offer browser sign-in for apps (no `native_pkce` in `/api/status`). */
  | "signInUnsupported"
  /** The stored session is gone or was rejected; the user has to sign in again. */
  | "signInRequired"
  | "signInFailed"
  | "cancelled"
  | "timedOut"
  | "disconnected"
  | "rpc";

/** Everything that can go wrong talking to a gateway, in terms the UI can show. */
export class GatewayError extends Error {
  constructor(
    readonly kind: GatewayErrorKind,
    /** The gateway's or system's own words, when there are any. */
    readonly detail?: string,
    /** The HTTP status for `http`, the JSON-RPC code for `rpc`. */
    readonly code?: number,
  ) {
    super(detail ? `${kind}: ${detail}` : kind);
  }

  get text(): string {
    switch (this.kind) {
      case "unreachable":
        // The network library's own words ("error sending request for url …") don't help here.
        return "Can't reach the gateway. Check the address, and that hermes dashboard is running there.";
      case "http":
        return this.detail ? `${this.detail} (HTTP ${this.code})` : `The gateway answered HTTP ${this.code}.`;
      case "invalidResponse":
        return "The gateway sent a response Unibot doesn't understand.";
      case "signInUnsupported":
        return "This gateway doesn't offer browser sign-in for apps. Update Hermes on it.";
      case "signInRequired":
        return "Your sign-in expired. Sign in again.";
      case "signInFailed":
        return `Sign-in didn't finish: ${this.detail}`;
      case "cancelled":
        return "Sign-in was cancelled.";
      case "timedOut":
        return "The gateway took too long to answer.";
      case "disconnected":
        return "The connection to the gateway closed.";
      case "rpc":
        return this.detail ?? "The gateway refused the request.";
    }
  }
}

export function isGatewayError(error: unknown, kind?: GatewayErrorKind): error is GatewayError {
  return error instanceof GatewayError && (kind === undefined || error.kind === kind);
}

/** An error in words for the UI. */
export function describeError(error: unknown, gateway?: GatewayAddress): string {
  if (isGatewayError(error, "unreachable") && gateway) {
    return gateway.isTailnet
      ? `Can't reach ${gateway.displayName}. It's a Tailscale address, so check that Tailscale is on and signed in on this computer.`
      : `Can't reach ${gateway.displayName}. Check the address, and that hermes dashboard is running there.`;
  }
  if (error instanceof AddressError) {
    switch (error.problem) {
      case "empty":
        return "Enter your gateway's address.";
      case "invalid":
        return "That doesn't look like a gateway address.";
      case "insecureHttp":
        return `${error.host} is on the public internet, so use https:// to keep your sign-in private.`;
    }
  }
  if (error instanceof GatewayError) return error.text;
  return error instanceof Error ? error.message : String(error);
}
