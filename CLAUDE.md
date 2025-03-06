# Agentek Project Guidelines

## Commands
- Install: `pnpm install`
- Test all: `pnpm test`
- Test single file: `pnpm test -- path/to/file.test.ts`
- Run single test: Use `it.only("test name", ...)` in the test file

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
Very strict configuration with all strict flags enabled. ES2020 target.