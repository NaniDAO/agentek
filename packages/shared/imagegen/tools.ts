import { createTool } from "../client.js";
import { z } from "zod";
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
      negativePrompt: z.string().optional(),
      steps: z.number().int().min(1).max(50).default(30).optional(),
    }),
    execute: async (_client, args) => {
      const { prompt, negativePrompt, steps } = args;

      /* 1 ▶ Generate the image (binary) */
      const fwEndpoint =
        `https://api.fireworks.ai/inference/v1/image_generation/${model}`;
      const fwRes = await fetch(fwEndpoint, {
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
      });

      if (!fwRes.ok) {
        const detail = await fwRes.text().catch(() => fwRes.statusText);
        throw new Error(`Fireworks error ${fwRes.status}: ${detail}`);
      }

      const imageBuffer = await fwRes.arrayBuffer();

      /* 2 ▶ Pin to IPFS via Pinata */
      const formData = new FormData();
      formData.append("file", new Blob([imageBuffer]), "image.png");
      formData.append(
        "pinataMetadata",
        JSON.stringify({ name: "AI Generated Image", keyvalues: { prompt } })
      );

      const pinRes = await fetch(
        "https://api.pinata.cloud/pinning/pinFileToIPFS",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${pinataJWT}` },
          body: formData,
        },
      );

      const pinJson = await pinRes.json();
      if (!pinJson?.IpfsHash) {
        throw new Error(`Failed to pin image to IPFS: ${pinJson?.error || ""}`);
      }

      return {
        prompt,
        ipfsCid: pinJson.IpfsHash,
        ipfsUrl: `https://content.wrappr.wtf/ipfs/${pinJson.IpfsHash}`,
      };
    },
  });
}
