export { allCredentialOrigins as credentialOrigins } from "../shared/credentialTools/origins.js";
import type { BaseTool } from "../shared/client.js";
import { embeddedTools as iphoneTools } from "./iphone-tools.js";
import { embeddedTools as macosTools } from "./macos-tools.js";
export const embeddedProfile = "universal";
export function embeddedTools(enabled: string[] = [], platform?: string): BaseTool[] {
  return platform === "macos" ? macosTools(enabled) : iphoneTools(enabled);
}
