import type { BaseTool } from "../shared/client.js";
import { iphoneCoreTools } from "./iphone-core-tools.js";
import { credentialTools } from "../shared/credentialTools/index.js";
export { allCredentialOrigins as credentialOrigins } from "../shared/credentialTools/origins.js";
export const embeddedProfile = "iphone";
export function embeddedTools(enabled: string[] = [], _platform?: string): BaseTool[] {
  return [...iphoneCoreTools(), ...credentialTools(enabled)];
}
