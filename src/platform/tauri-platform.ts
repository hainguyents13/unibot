import { Channel, invoke } from "@tauri-apps/api/core";
import { fetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { SavedSignIn, TokenStore } from "../hermes/auth-session";
import type { GatewayAddress } from "../hermes/gateway-address";
import { GatewayError } from "../hermes/gateway-error";
import type { HttpTransport } from "../hermes/http";
import type { RpcSocket } from "../hermes/json-rpc-channel";
import type { Loopback } from "../hermes/native-sign-in";
import type { SessionDeps } from "../hermes/session";

/**
 * Requests go through the Rust side (Tauri's HTTP plugin), which the gateway's CORS rules don't
 * apply to. An empty Origin removes the header the plugin would add, so requests look like the
 * other native apps' (it needs the plugin's `unsafe-headers` feature).
 */
const http: HttpTransport = async (request) => {
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: { ...request.headers, Origin: "" },
      body: request.body,
      signal: AbortSignal.timeout(request.timeoutMs),
      connectTimeout: Math.min(request.timeoutMs, 15_000),
    });
    return { status: response.status, body: await response.text() };
  } catch (error) {
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new GatewayError("timedOut");
    }
    throw error;
  }
};

type PluginMessage = { type: "Text"; data: string } | { type: "Close" | "Binary" | "Ping" | "Pong"; data: unknown } | string;

/**
 * A WebSocket through Tauri's WebSocket plugin, called directly rather than through its JS wrapper:
 * the wrapper drops frames that arrive before `connect` resolves, and `gateway.ready` can.
 */
const makeSocket = async (url: string): Promise<RpcSocket> => {
  const early: string[] = [];
  let messageListener: ((text: string) => void) | undefined;
  let closeListener: (() => void) | undefined;
  let closed = false;
  const markClosed = () => {
    if (closed) return;
    closed = true;
    closeListener?.();
  };

  const channel = new Channel<PluginMessage>();
  channel.onmessage = (message) => {
    if (typeof message === "object" && message.type === "Text") {
      if (messageListener) messageListener(message.data);
      else early.push(message.data);
    } else if (typeof message === "string" || message.type === "Close") {
      // A string is the plugin reporting a read error.
      markClosed();
    }
  };
  const id = await invoke<number>("plugin:websocket|connect", {
    url,
    onMessage: channel,
    config: { maxMessageSize: 16 * 1024 * 1024 },
  });

  return {
    async send(text) {
      if (closed) throw new GatewayError("disconnected");
      try {
        await invoke("plugin:websocket|send", { id, message: { type: "Text", data: text } });
      } catch (error) {
        markClosed();
        throw error;
      }
    },
    close() {
      if (closed) return;
      invoke("plugin:websocket|send", {
        id,
        message: { type: "Close", data: { code: 1000, reason: "" } },
      }).catch(() => {});
      markClosed();
    },
    onMessage(listener) {
      messageListener = listener;
      for (const text of early.splice(0)) listener(text);
    },
    onClose(listener) {
      closeListener = listener;
      if (closed) listener();
    },
  };
};

/** The sign-in lives in Windows Credential Manager, through the app's Rust commands. */
const tokenStore: TokenStore = {
  async load(gateway: GatewayAddress) {
    const secret = await invoke<string | null>("token_load", { gateway: gateway.baseUrl });
    if (!secret) return undefined;
    const saved = JSON.parse(secret) as SavedSignIn;
    return typeof saved?.refreshToken === "string" ? saved : undefined;
  },
  async save(gateway, signIn) {
    await invoke("token_save", { gateway: gateway.baseUrl, secret: JSON.stringify(signIn) });
  },
  async delete(gateway) {
    await invoke("token_delete", { gateway: gateway.baseUrl });
  },
};

const loopback: Loopback = {
  start: () => invoke<number>("loopback_start"),
  wait: (timeoutSeconds) => invoke<string>("loopback_wait", { timeoutSeconds }),
  cancel: () => invoke<void>("loopback_cancel"),
};

/** Where versions before the recent list kept the one gateway's address. */
const LEGACY_GATEWAY_KEY = "unibot.gateway";

/**
 * The recent gateways live in a file in the app's config folder, not the webview's storage: a
 * development build's page has another origin than the installed app's, so it would see none.
 */
const settings: SessionDeps["settings"] = {
  async recentGateways() {
    const recent = await invoke<string[]>("gateways_load");
    if (recent.length) return recent;
    try {
      const legacy = localStorage.getItem(LEGACY_GATEWAY_KEY);
      return legacy ? [legacy] : [];
    } catch {
      return [];
    }
  },
  async saveRecentGateways(addresses) {
    await invoke("gateways_save", { gateways: addresses });
  },
};

export const tauriSessionDeps: SessionDeps = { http, makeSocket, tokenStore, loopback, openUrl, settings };
