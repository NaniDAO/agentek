# Agentek Project Guidelines

## Requirements
- Node.js >= 18.17.0 (Required for proper fetch API support)
- pnpm

## Commands
- Install: `pnpm i`
- Build: `pnpm run build`
- Test all: `pnpm run test`
- Test single file: `pnpm test -- path/to/file.test.ts`
- Run single test: Use `it.only("test name", ...)` in the test file
- List all tools: `bun run list`

## Code Style
- **Imports**: Group external libraries first, then internal. Use `type` keyword for type imports.
- **Naming**: PascalCase for types/interfaces, camelCase for functions/variables, underscore prefix for private.
- **Tool patterns**: 
  - Standard tools: `get*Tool`, `search*Tool`
  - Intent tools: `intent*Tool` for blockchain transactions
- **Types**: Use Zod for parameter validation with descriptive strings. Explicit type annotations.
- **Error handling**: Descriptive template literals with context. Use try/catch for external calls.
- **Code organization**: Modular directories with separate files for constants, tools, and intents.
- **Tool structure**: Follow the `createTool` pattern with name, description, parameters, and execute function.
- **Security**: Validate all inputs. Never commit API keys. Use environment variables for secrets.

## TypeScript
- Very strict configuration with all strict flags enabled. ES2022 target.
- When using ESM format, always use explicit file extensions (.js) in import paths
- Always add proper dts generation using tsup with `dts: true` 
- Fix each error during build individually, do not disable dts generation
- In tsconfig.json, ensure proper moduleResolution is set to match the ESM format
- Never remove imports or code during build fixing unless completely necessary