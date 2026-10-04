import { openUrl } from "@tauri-apps/plugin-opener";

export function openExternal(url: string): Promise<void> {
  return openUrl(url);
}
