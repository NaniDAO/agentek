import { it, expect } from "vitest";
import { pageExtractionScript } from "./page.js";
function extract(values: {text: string, excluded?: boolean}[], links: any[] = []) {
 const nodes = values.map(value => ({textContent:value.text, parentElement:{closest: () => value.excluded ? {} : null}}));
 let index = 0;
 const document = {title:"Fixture", baseURI:"https://example.com/docs", body:{querySelectorAll:()=>links}, querySelector:()=>null,
  createTreeWalker:()=>({nextNode:()=>nodes[index++] || null})};
 return new Function("document", "NodeFilter", "return " + pageExtractionScript)(document, {SHOW_TEXT:4});
}
it("excludes scripts/forms and resolves only HTTPS links", () => {
 const link = (href: string) => ({getAttribute:()=>href,textContent:"Link"});
 const result = extract([{text:" Hello  world "},{text:"secret",excluded:true}], [link("/next"),link("javascript:alert(1)"),link("https://user:pass@example.com")]);
 expect(result.text).toBe("Hello world");
 expect(result.links).toEqual([{title:"Link",url:"https://example.com/next"}]);
});
it("bounds text and link counts and exposes truncation", () => {
 const result = extract([{text:"x".repeat(30000)}], Array(60).fill({getAttribute:()=>"/",textContent:"Home"}));
 expect(result.text.length).toBe(24000); expect(result.truncated).toBe(true); expect(result.links.length).toBe(40);
});
