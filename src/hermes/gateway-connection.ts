import type { AuthSession } from "./auth-session";
import { JsonRpcChannel, type GatewayReady, type RpcSocket } from "./json-rpc-channel";

export type SocketFactory = (url: string) => Promise<RpcSocket>;

/** Opens an authenticated JSON-RPC socket: mint a ticket, dial `/api/ws?ticket=…`, wait for `gateway.ready`. */
export async function connectGateway(
  auth: AuthSession,
  makeSocket: SocketFactory,
): Promise<{ channel: JsonRpcChannel; ready: GatewayReady }> {
  const ticket = await auth.webSocketTicket();
  const channel = new JsonRpcChannel(await makeSocket(auth.gateway.webSocketUrl(ticket)));
  channel.start();
  try {
    const ready = await channel.waitUntilReady();
    // Without this the gateway fails approval requests at once instead of asking the app.
    await channel.call("client.capabilities", { server_requests: true });
    return { channel, ready };
  } catch (error) {
    channel.close();
    throw error;
  }
}

/** Delay before reconnect attempt `attempt` (0-based): 300 ms doubling to a 15 s cap. */
export function backoffMs(attempt: number): number {
  return Math.min(300 * 2 ** Math.min(attempt, 10), 15_000);
}
