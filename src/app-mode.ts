import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * Whether to show the demo instead of connecting. In a plain browser (the Vite preview used for
 * screenshots) there is no gateway connection to make, so it is always the demo. In the app, a
 * debug build started with `UNIBOT_DEMO=1` shows it.
 */
export async function isDemo(): Promise<boolean> {
  if (!isTauri()) return true;
  return invoke<boolean>("demo_mode");
}
