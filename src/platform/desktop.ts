import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** The event the app sends when a notification is clicked; its payload is the chat's target. */
const OPEN_EVENT = "unibot://open";

/** Shows a Windows notification; clicking it opens `target` (`bot:<id>` or `room:<id>`). */
export function notify(title: string, body: string, target: string): void {
  if (!isTauri()) return;
  invoke("notify", { title, body, target }).catch((error: unknown) => console.error("Notification failed", error));
}

/** Puts a dot on the tray icon while a Bot needs you. */
export function setAttention(needsYou: boolean): void {
  if (!isTauri()) return;
  invoke("set_attention", { needsYou }).catch(() => {});
}

/** Calls `open` with the target of a clicked notification. Returns a way to stop listening. */
export function onOpenTarget(open: (target: string) => void): () => void {
  if (!isTauri()) return () => {};
  const stop = listen<string>(OPEN_EVENT, (event) => open(event.payload));
  return () => void stop.then((unlisten) => unlisten());
}
