import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAllDocuments, visit } from "yaml";
import { ZodError } from "zod";
import { mvpTaskSchema, type MvpTask } from "./schema.js";

const MAX_TASK_FILE_BYTES = 1_048_576;

export interface TaskValidationIssue {
  path: string;
  message: string;
}

export class TaskValidationError extends Error {
  constructor(public readonly issues: TaskValidationIssue[]) {
    super(
      `Invalid gym task:\n${issues
        .map((issue) => `- ${issue.path || "<root>"}: ${issue.message}`)
        .join("\n")}`,
    );
    this.name = "TaskValidationError";
  }
}

export class TaskFileError extends Error {
  readonly cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "TaskFileError";
    this.cause = options?.cause;
  }
}

export function parseTask(input: unknown): MvpTask {
  try {
    return mvpTaskSchema.parse(input) as MvpTask;
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    throw new TaskValidationError(
      error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
}

function parseYaml(source: string, sourceName: string): unknown {
  const documents = parseAllDocuments(source, {
    merge: false,
    prettyErrors: true,
    schema: "core",
    uniqueKeys: true,
    version: "1.2",
  });
  if (documents.length !== 1) {
    throw new TaskFileError(
      `${sourceName} must contain exactly one YAML document`,
    );
  }
  const document = documents[0];
  if (document.errors.length > 0) {
    throw new TaskFileError(
      `Could not parse ${sourceName}: ${document.errors
        .map((error) => error.message)
        .join("; ")}`,
    );
  }
  // YAML 1.2 treats unquoted 0x-prefixed scalars as integers. Ethereum
  // addresses are conventionally written that way, so preserve their exact
  // 40-nybble source text before conversion to JavaScript (including leading
  // zeroes that a numeric conversion would destroy).
  visit(document, {
    Scalar(_key, node) {
      if (node.source && /^0x[0-9a-fA-F]{40}$/.test(node.source)) {
        node.value = node.source;
      }
    },
  });
  try {
    return document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new TaskFileError(`Could not resolve ${sourceName}`, {
      cause: error,
    });
  }
}

export async function loadTask(pathOrUrl: string | URL): Promise<MvpTask> {
  const path = pathOrUrl instanceof URL ? fileURLToPath(pathOrUrl) : pathOrUrl;
  const extension = extname(path).toLowerCase();
  if (![".json", ".yaml", ".yml"].includes(extension)) {
    throw new TaskFileError(
      `Unsupported task file extension ${extension || "<none>"}; expected .json, .yaml, or .yml`,
    );
  }

  let fileSize: number;
  try {
    fileSize = (await stat(path)).size;
  } catch (error) {
    throw new TaskFileError(`Could not stat task file ${path}`, { cause: error });
  }
  if (fileSize > MAX_TASK_FILE_BYTES) {
    throw new TaskFileError(
      `Task file exceeds the ${MAX_TASK_FILE_BYTES}-byte limit`,
    );
  }

  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    throw new TaskFileError(`Could not read task file ${path}`, { cause: error });
  }
  if (Buffer.byteLength(source, "utf8") > MAX_TASK_FILE_BYTES) {
    throw new TaskFileError(
      `Task file exceeds the ${MAX_TASK_FILE_BYTES}-byte limit`,
    );
  }

  let input: unknown;
  if (extension === ".json") {
    try {
      input = JSON.parse(source);
    } catch (error) {
      throw new TaskFileError(`Could not parse JSON task file ${path}`, {
        cause: error,
      });
    }
  } else {
    input = parseYaml(source, path);
  }
  return parseTask(input);
}
