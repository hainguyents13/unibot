import type { ChatRequest } from "./requests";
import { shortCommand } from "./requests";

/** Something a Bot did that's worth a notification when you're not looking. */
export interface Alert {
  kind: "reply" | "needsYou";
  /** What the notification says. */
  text: string;
}

/** A Bot's or room's alert, with where clicking it should go. */
export interface TargetedAlert extends Alert {
  /** `bot:<id>` or `room:<id>`. */
  target: string;
  /** Who it's from: the Bot's or room's name. */
  title: string;
}

/** What a waiting request asks of you, in one line. */
export function requestAlertText(request: ChatRequest): string {
  switch (request.kind) {
    case "approval":
      return `Wants to run “${shortCommand(request.command)}”`;
    case "clarify":
      return request.questions[0]?.text ?? "Has a question for you";
    case "secret":
      return `Needs ${request.name}`;
    case "sudo":
      return "Needs the sudo password";
  }
}

/** A reply cut to notification length, without Markdown marks. */
export function alertPreview(text: string): string {
  const plain = text.replace(/[*_`#>~]/g, "").replace(/\s+/g, " ").trim();
  return plain.length > 140 ? `${plain.slice(0, 139)}…` : plain;
}

/** Listeners for one source of alerts. */
export class AlertSource {
  private readonly listeners = new Set<(alert: Alert) => void>();
  /** Requests already announced: the gateway sends waiting ones again on every attach. */
  private readonly announced = new Set<string>();

  onAlert(listener: (alert: Alert) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(alert: Alert): void {
    for (const listener of this.listeners) listener(alert);
  }

  /** Announces a request once, however often the gateway sends it. */
  announce(id: string, text: string): void {
    if (this.announced.has(id)) return;
    this.announced.add(id);
    this.emit({ kind: "needsYou", text });
  }
}
