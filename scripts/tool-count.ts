import { allTools } from "../src/shared";

const tools = allTools();

console.log(`${allTools().length} tools`);
console.log("list of tools:");

tools.forEach((tool, i) => console.log(`${i + 1} ${tool.name}`));
