import { isTauri } from "@tauri-apps/api/core";

/** Opens a web link in the default browser. Only http and https: a reply could hold any scheme. */
export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  if (!isTauri()) {
    window.open(url, "_blank", "noopener");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}
