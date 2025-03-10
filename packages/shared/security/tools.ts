/**
 * This code uses data from scamsniffer/scam-database
 * Repository: https://github.com/scamsniffer/scam-database
 * License: GNU General Public License v3.0
 * Copyright (c) ScamSniffer
 *
 * Note: The data is updated daily but has a 7-day delay from real-time data
 * to balance between providing free resources and protecting data integrity.
 */
import { Chain } from "viem";
import { createTool } from "../client";
import { z } from "zod";

const supportedChains: Chain[] = []; // essentially cross chain

function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url.toLowerCase());
    return urlObj.hostname.replace(/^www\./, "");
  } catch {
    // If URL parsing fails, try basic string manipulation
    const normalized = url
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0];
    return normalized || "";
  }
}

// Cache configuration
let addressBlacklist: string[] | null = null;
let domainBlacklist: string[] | null = null;
let lastAddressFetch = 0;
let lastDomainFetch = 0;
const CACHE_DURATION = 1000 * 60 * 60 * 24; // 24 hours to match daily updates

async function getAddressBlacklist() {
  const now = Date.now();
  if (!addressBlacklist || now - lastAddressFetch > CACHE_DURATION) {
    const response = await fetch(
      "https://raw.githubusercontent.com/scamsniffer/scam-database/refs/heads/main/blacklist/address.json",
    );
    addressBlacklist = await response.json();
    lastAddressFetch = now;
  }
  return addressBlacklist;
}

async function getDomainBlacklist() {
  const now = Date.now();
  if (!domainBlacklist || now - lastDomainFetch > CACHE_DURATION) {
    const response = await fetch(
      "https://raw.githubusercontent.com/scamsniffer/scam-database/refs/heads/main/blacklist/domains.json",
    );
    domainBlacklist = await response.json();
    lastDomainFetch = now;
  }
  return domainBlacklist;
}

export const checkMaliciousAddress = createTool({
  name: "checkMaliciousAddress",
  description:
    "Check if an Ethereum address has been associated with malicious activity",
  supportedChains,
  parameters: z.object({
    address: z.string(),
  }),
  execute: async (_client, args) => {
    const blacklist = await getAddressBlacklist();
    if (!blacklist) {
      throw new Error("Failed to fetch address blacklist");
    }

    return {
      address: args.address,
      isMalicious: blacklist.includes(args.address.toLowerCase()),
    };
  },
});

export const checkMaliciousWebsite = createTool({
  name: "checkMaliciousWebsite",
  description:
    "Check if a website has been associated with crypto scams or malicious activity",
  parameters: z.object({
    website: z.string(),
  }),
  execute: async (_client, args) => {
    const blacklist = await getDomainBlacklist();
    if (!blacklist) {
      throw new Error("Failed to fetch domain blacklist");
    }

    const formattedWebsite = normalizeUrl(args.website);

    return {
      website: args.website,
      isMalicious: blacklist.includes(formattedWebsite),
    };
  },
});
