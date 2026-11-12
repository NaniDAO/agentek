import { providerBytes, providerJSON } from "../utils/fetch.js";
import { createTool } from "../client.js";
import * as z from "zod";
import { ImageGenToolOptions } from "./index.js";

/**
 * Uses Fireworks AI Stable Diffusion XL,
 * then pins the result to IPFS via Pinata.
 */
export function createImageGenAndPinTool({
  fireworksApiKey,          //  <-- NEW
  pinataJWT,
  model = "accounts/fireworks/models/stable-diffusion-xl-1024-v1-0", // default SDXL
}: ImageGenToolOptions & { fireworksApiKey: string; model?: string }) {
  return createTool({
    name: "generateAndPinImage",
    description:
      `Generate an image from text with Fireworks AI (${model}), then upload ` +
      "it to IPFS via Pinata. Returns the IPFS CID and link.",
    parameters: z.object({
      prompt: z.string().describe("A detailed prompt for image generation"),
      negativePrompt: z.string().optional().describe("Things to exclude from the generated image (e.g. 'blurry, low quality, watermark')"),
      steps: z.number().int().min(1).max(50).default(30).optional().describe("Number of diffusion steps (1-50). Higher = better quality but slower. Default: 30"),
    }),
    execute: async (_client, args) => {
      const { prompt, negativePrompt, steps } = args;

      /* 1 ▶ Generate the image (binary) */
      const fwEndpoint =
        `https://api.fireworks.ai/inference/v1/image_generation/${model}`;
      const imageBuffer = await providerBytes(fwEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${fireworksApiKey}`,
          "Content-Type": "application/json",
          Accept: "image/png",            // binary response → easier piping
        },
        body: JSON.stringify({
          prompt,
          negative_prompt: negativePrompt,
          width: 1024,
          height: 1024,
          steps,                          // default 30
          safety_check: true,
        }),
      }, "Image generation failed", {maximumBytes: 16 * 1024 * 1024, timeoutMs: 120_000});
      if (imageBuffer.length === 0) throw new Error("Image generation returned no image");

      /* 2 ▶ Pin to IPFS via Pinata */
      const formData = new FormData();
      formData.append("file", new Blob([imageBuffer]), "image.png");
      formData.append(
        "pinataMetadata",
        JSON.stringify({ name: "AI Generated Image", keyvalues: { prompt } })
      );

      const pinJson = await providerJSON(
        "https://api.pinata.cloud/pinning/pinFileToIPFS",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${pinataJWT}` },
          body: formData,
        }, "Image publication failed", {maximumBytes: 256 * 1024, timeoutMs: 60_000},
      );

      if (typeof pinJson?.IpfsHash !== "string" || !/^[a-zA-Z0-9]{32,160}$/.test(pinJson.IpfsHash)) {
        throw new Error("Failed to pin image to IPFS");
      }

      return {
        prompt,
        ipfsCid: pinJson.IpfsHash,
        ipfsUrl: `https://content.wrappr.wtf/ipfs/${pinJson.IpfsHash}`,
      };
    },
  });
}
