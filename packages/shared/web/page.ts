import { z } from "zod";
import { createTool } from "../client.js";

// Runs in a native host's isolated WebKit content world. No network or wallet access.
export const pageExtractionScript = `(() => {
 const root = document.querySelector('main, article, [role="main"]') || document.body;
 if (!root) return {title: document.title || '', text: '', links: [], truncated: false};
 const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
 let text = '', truncated = false, node;
 while ((node = walker.nextNode())) {
   const parent = node.parentElement;
   if (!parent || parent.closest('script,style,noscript,template,input,textarea,select,[hidden],[aria-hidden="true"]')) continue;
   const value = (node.textContent || '').replace(/\\s+/g, ' ').trim();
   if (!value) continue;
   if (text.length + value.length + 1 > 24000) { text += '\\n' + value.slice(0, Math.max(0, 24000-text.length-1)); truncated = true; break; }
   text += (text ? '\\n' : '') + value;
 }
 const links = [];
 for (const anchor of root.querySelectorAll('a[href]')) {
   if (links.length >= 40) break;
   try { const url = new URL(anchor.getAttribute('href'), document.baseURI);
     if (url.protocol === 'https:' && !url.username && !url.password) links.push({title: (anchor.textContent || '').trim().slice(0,200), url: url.href.slice(0,4096)});
   } catch (_) {}
 }
 return {title: (document.title || '').slice(0,300), text, links, truncated};
})()`;

export const webPageExtractor = createTool({
 name: "webPageExtractor", description: "Host-only offline page extraction script. No browsing or signing authority.",
 parameters: z.object({}).strict(), execute: async () => ({schemaVersion: 1, script: pageExtractionScript}),
});
const httpsURL = z.string().max(4096).url().refine(value => {
 const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password;
}, "An HTTPS URL without credentials is required");
export const webPageResult = createTool({
 name: "webPageResult", description: "Host-only normalization of untrusted page observations. No network calls.",
 parameters: z.object({
  requestedURL: httpsURL, finalURL: httpsURL, retrievedAt: z.string().datetime(),
  source: z.enum(["url", "open_page"]), status: z.enum(["read", "empty", "blocked", "unsupported", "failed"]),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  title: z.string().max(300), text: z.string().max(24000),
  links: z.array(z.object({title: z.string().max(200), url: httpsURL}).strict()).max(40),
  truncated: z.boolean(), note: z.string().max(1000),
 }).strict(),
 execute: async (_client, args) => ({schemaVersion: 1, trust: "untrusted_web_content", ...args}),
});
