import type { BaseTool } from "../shared/client.js";
import { iphoneCoreTools } from "./iphone-core-tools.js";
import { credentialTools } from "../shared/credentialTools/base.js";
export { baseCredentialOrigins as credentialOrigins } from "../shared/credentialTools/base-origins.js";
// Preserve the iPhone bridge contract; provenance records the narrower build profile.
export const embeddedProfile = "iphone";
export function embeddedTools(enabled: string[] = [], _platform?: string): BaseTool[] {
  return [...iphoneCoreTools(), ...credentialTools(enabled)];
}
