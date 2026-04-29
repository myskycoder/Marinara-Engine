import { delimiter, dirname, win32 } from "path";

type LlamaRuntimeEnvInput = {
  serverPath: string;
  directoryPath?: string;
  source: string | null | undefined;
};

function prependPathEntry(currentValue: string | undefined, entry: string, pathDelimiter = delimiter): string {
  const segments = (currentValue ?? "")
    .split(pathDelimiter)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => segment !== entry);

  return [entry, ...segments].join(pathDelimiter);
}

export function buildLlamaProcessEnv(
  runtime: LlamaRuntimeEnvInput,
  platform: NodeJS.Platform = process.platform,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...baseEnv };

  if (runtime.source !== "bundled") {
    return env;
  }

  if (platform === "win32") {
    const runtimeDir = win32.dirname(runtime.serverPath);
    env.PATH = prependPathEntry(
      prependPathEntry(env.PATH, runtimeDir, win32.delimiter),
      runtime.directoryPath ?? runtimeDir,
      win32.delimiter,
    );
  } else {
    const runtimeDir = dirname(runtime.serverPath);
    if (platform === "linux" || platform === "android") {
      env.LD_LIBRARY_PATH = prependPathEntry(env.LD_LIBRARY_PATH, runtimeDir);
    } else if (platform === "darwin") {
      env.DYLD_LIBRARY_PATH = prependPathEntry(env.DYLD_LIBRARY_PATH, runtimeDir);
    }
  }

  return env;
}
