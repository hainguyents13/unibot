import type { RpcSocket } from "./json-rpc-channel";

/** An in-memory socket for tests: records what the app sends and lets a test play the gateway. */
export class FakeSocket implements RpcSocket {
  readonly sent: Array<Record<string, unknown>> = [];
  closed = false;
  private messageListener: ((text: string) => void) | undefined;
  private readonly early: string[] = [];
  private closeListener: (() => void) | undefined;
  /** Answers each request the app sends, like a gateway would. */
  reply: ((frame: Record<string, unknown>) => unknown) | undefined;

  async send(text: string): Promise<void> {
    if (this.closed) throw new Error("closed");
    const frame = JSON.parse(text) as Record<string, unknown>;
    this.sent.push(frame);
    if (this.reply && typeof frame.id === "number" && typeof frame.method === "string") {
      const result = this.reply(frame);
      if (result !== undefined) queueMicrotask(() => this.receive({ jsonrpc: "2.0", id: frame.id, result }));
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeListener?.();
  }

  onMessage(listener: (text: string) => void): void {
    this.messageListener = listener;
    for (const text of this.early.splice(0)) listener(text);
  }

  onClose(listener: () => void): void {
    this.closeListener = listener;
  }

  receive(frame: unknown): void {
    const text = JSON.stringify(frame);
    if (this.messageListener) this.messageListener(text);
    else this.early.push(text);
  }

  sendReady(payload: Record<string, unknown> = {}): void {
    this.receive({ jsonrpc: "2.0", method: "event", params: { type: "gateway.ready", payload } });
  }

  /** The server side hangs up. */
  drop(): void {
    this.close();
  }

  sentMethods(): string[] {
    return this.sent.map((f) => f.method as string).filter(Boolean);
  }
}
