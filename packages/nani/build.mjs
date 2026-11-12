import '../../scripts/check-dependency-pins.mjs';
const profile = process.argv[2] ?? 'iphone';
if (!['iphone', 'macos', 'universal', 'minimal', 'nani-chan'].includes(profile)) throw new Error('Expected iphone, macos, universal, minimal, or nani-chan');
// An optional third argument selects an app-owned collection module exporting
// embeddedTools and embeddedProfile, with the same dependency boundary checks.
const collection = new URL(process.argv[3] ?? `./${profile}-tools.ts`, import.meta.url).pathname;
const result = await Bun.build({
  entrypoints: ['./jsc-entry.ts'], target: 'browser', minify: true,
  plugins: [{name: 'embedded-dependency-boundary', setup(build) {
    build.onResolve({filter: /./}, args => {
      if (args.path === "./selected-tools.js") return {path: collection};
      if (/^@agentek\//.test(args.path)) throw new Error(`Native profiles must import committed source: ${args.path}`);
      if (profile === 'nani-chan' && /(?:^|\/)twitter(?:\/|$)/.test(args.path)) throw new Error(`X is excluded from nani-chan: ${args.path}`);
      if (/(?:@solana\/|@x402\/|cheerio|twitter-api-v2|zod-to-json-schema|(?:^|\/)solana\/)/.test(args.path)) {
        throw new Error(`Unsupported embedded dependency: ${args.path}`);
      }
    });
  }}],
});
if (!result.success) throw new AggregateError(result.logs, 'Embedded build failed');
const source = await result.outputs[0].text();
if (profile === 'nani-chan' && /api\.x\.com|api\.jup\.ag|getHomeTimeline|searchRecentTweets|getSolanaToken/.test(source)) {
  throw new Error('Excluded X/Solana implementation or endpoint entered the nani-chan bundle');
}
await Bun.write('dist/nani-tools.js', source);
console.log(`${profile}: ${result.outputs[0].size.toLocaleString()} bytes; optional SDK boundary checked`);
