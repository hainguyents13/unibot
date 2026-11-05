export type AddressProblem = "empty" | "invalid" | "insecureHttp";

export class AddressError extends Error {
  constructor(
    readonly problem: AddressProblem,
    readonly host?: string,
  ) {
    super(problem);
  }
}

/**
 * Where a Hermes gateway's dashboard listener lives, e.g. `https://hermes.example.com` or
 * `http://100.101.102.103:9119`. A path prefix (for gateways behind a reverse proxy) is kept.
 */
export class GatewayAddress {
  /** Scheme, host, optional port and optional path prefix, with no trailing slash. */
  readonly baseUrl: string;
  private readonly parsed: URL;

  private constructor(url: URL) {
    this.parsed = url;
    this.baseUrl = `${url.protocol}//${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  }

  /**
   * Accepts what a person would paste: with or without a scheme, with or without a trailing slash.
   * Without a scheme, private and Tailscale addresses get `http`, everything else `https`.
   */
  static parse(input: string): GatewayAddress {
    const trimmed = input.trim();
    if (!trimmed) throw new AddressError("empty");
    const hasScheme = trimmed.includes("://");
    let url: URL;
    try {
      url = new URL(hasScheme ? trimmed : `http://${trimmed}`);
    } catch {
      throw new AddressError("invalid");
    }
    const host = bareHost(url);
    if (!host || url.username || url.password || url.search || url.hash) throw new AddressError("invalid");

    const isPrivate = GatewayAddress.isPrivate(host);
    if (!hasScheme && !isPrivate) url.protocol = "https:";
    if (url.protocol === "http:" && !isPrivate) throw new AddressError("insecureHttp", host);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new AddressError("invalid");

    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return new GatewayAddress(url);
  }

  /** A gateway endpoint, e.g. `url("/api/status")`. */
  url(path: string): string {
    return this.baseUrl + path;
  }

  /**
   * The JSON-RPC socket, authenticated by a single-use ticket in the query.
   * Remote gateways refuse tickets carried in the `Sec-WebSocket-Protocol` header.
   */
  webSocketUrl(ticket: string): string {
    const scheme = this.parsed.protocol === "https:" ? "wss:" : "ws:";
    return `${scheme}${this.baseUrl.slice(this.parsed.protocol.length)}/api/ws?ticket=${encodeURIComponent(ticket)}`;
  }

  /** Short form for the UI: host and port. */
  get displayName(): string {
    return this.parsed.host;
  }

  /**
   * A Tailscale address (100.64.0.0/10, fd7a:115c:a1e0::/48) or MagicDNS name (`*.ts.net`),
   * which a device reaches only while Tailscale is on and signed in to the same tailnet.
   */
  get isTailnet(): boolean {
    const host = bareHost(this.parsed);
    if (host.endsWith(".ts.net") || host.startsWith("fd7a:115c:a1e0:")) return true;
    const octets = ipv4Octets(host);
    return octets !== undefined && octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
  }

  /**
   * Plain `http` that leaves this device outside a tunnel, so others on the network can read it.
   * Loopback stays on the device and Tailscale encrypts its traffic itself. Secrets go over this
   * only with your say-so each time.
   */
  get isUnencrypted(): boolean {
    if (this.parsed.protocol !== "http:") return false;
    const host = bareHost(this.parsed);
    const loopback = host === "localhost" || host === "::1" || ipv4Octets(host)?.[0] === 127;
    return !loopback && !this.isTailnet;
  }

  /**
   * Loopback, private-network, link-local and Tailscale addresses, plus `.local` and single-label
   * names. Traffic to these never crosses the open internet unencrypted on its own, so plain
   * `http` is allowed.
   */
  static isPrivate(host: string): boolean {
    host = host.toLowerCase();
    if (host === "localhost" || host.endsWith(".local")) return true;
    const octets = ipv4Octets(host);
    if (octets) {
      const [a, b] = octets;
      return (
        a === 127 ||
        a === 10 ||
        (a === 192 && b === 168) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 100 && b >= 64 && b <= 127)
      );
    }
    if (host.includes(":")) {
      return host === "::1" || /^(fc|fd|fe8|fe9|fea|feb)/.test(host);
    }
    return !host.includes(".");
  }
}

function bareHost(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function ipv4Octets(host: string): number[] | undefined {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return undefined;
  const octets = parts.map(Number);
  return octets.every((o) => o <= 255) ? octets : undefined;
}
