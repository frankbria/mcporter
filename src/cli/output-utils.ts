import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import type { CallResult, ImageContent } from '../result-utils.js';
import { logWarn } from './logger-context.js';

export type OutputFormat = 'auto' | 'text' | 'markdown' | 'json' | 'raw';
const RAW_INSPECT_DEPTH = 8;

export function printCallOutput<T>(wrapped: CallResult<T>, raw: T, format: OutputFormat): void {
  switch (format) {
    case 'raw': {
      printRaw(raw);
      return;
    }
    case 'json': {
      const jsonValue = wrapped.json();
      if (jsonValue !== null && attemptPrintJson(jsonValue)) {
        return;
      }
      printRaw(raw);
      return;
    }
    case 'markdown': {
      const markdown = wrapped.markdown();
      if (typeof markdown === 'string') {
        console.log(markdown);
        return;
      }
      const text = wrapped.text();
      if (typeof text === 'string') {
        console.log(text);
        return;
      }
      const jsonValue = wrapped.json();
      if (jsonValue !== null && attemptPrintJson(jsonValue)) {
        return;
      }
      printRaw(raw);
      return;
    }
    case 'text': {
      const text = wrapped.text();
      if (typeof text === 'string') {
        console.log(text);
        return;
      }
      const markdown = wrapped.markdown();
      if (typeof markdown === 'string') {
        console.log(markdown);
        return;
      }
      const jsonValue = wrapped.json();
      if (jsonValue !== null && attemptPrintJson(jsonValue)) {
        return;
      }
      printRaw(raw);
      return;
    }
    default: {
      const jsonValue = wrapped.json();
      if (jsonValue !== null && attemptPrintJson(jsonValue)) {
        return;
      }
      const markdown = wrapped.markdown();
      if (typeof markdown === 'string') {
        console.log(markdown);
        return;
      }
      const text = wrapped.text();
      if (typeof text === 'string') {
        console.log(text);
        return;
      }
      printRaw(raw);
    }
  }
}

export function tailLogIfRequested(result: unknown, enabled: boolean): void {
  // Some transports still encode log paths inside tool results; tail when explicitly asked.
  if (!enabled) {
    return;
  }
  const candidates: string[] = [];
  if (typeof result === 'string') {
    const idx = result.indexOf(':');
    if (idx !== -1) {
      const candidate = result.slice(idx + 1).trim();
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }
  if (result && typeof result === 'object') {
    const possibleKeys = ['logPath', 'logFile', 'logfile', 'path'];
    for (const key of possibleKeys) {
      const value = (result as Record<string, unknown>)[key];
      if (typeof value === 'string') {
        candidates.push(value);
      }
    }
  }

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      logWarn(`Log path not found: ${candidate}`);
      continue;
    }
    try {
      const content = fs.readFileSync(candidate, 'utf8');
      const lines = content.trimEnd().split(/\r?\n/);
      const tail = lines.slice(-20);
      console.log(`--- tail ${candidate} ---`);
      for (const line of tail) {
        console.log(line);
      }
    } catch (error) {
      logWarn(`Failed to read log file ${candidate}: ${(error as Error).message}`);
    }
  }
}

export function saveCallImagesIfRequested<T>(wrapped: CallResult<T>, outputDir: string | undefined): void {
  if (!outputDir) {
    return;
  }
  const images = wrapped.images();
  if (!images || images.length === 0) {
    return;
  }
  const resolvedDir = path.resolve(outputDir);
  try {
    fs.mkdirSync(resolvedDir, { recursive: true });
  } catch (error) {
    logWarn(`Unable to create image output directory ${resolvedDir}: ${(error as Error).message}`);
    return;
  }
  writeImages(images, resolvedDir);
}

function writeImages(images: ImageContent[], outputDir: string): void {
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const ext = extensionFromMimeType(img.mimeType);
    const outputPath = resolveImageOutputPath(outputDir, i + 1, ext);
    try {
      const buffer = Buffer.from(img.data, 'base64');
      fs.writeFileSync(outputPath, buffer);
      console.error(`[mcporter] Saved image: ${outputPath} (${buffer.length} bytes, ${img.mimeType})`);
    } catch (writeError) {
      logWarn(`Failed to save image ${i + 1} (${img.mimeType}): ${(writeError as Error).message}`);
    }
  }
}

function extensionFromMimeType(mimeType: string): string {
  const subtype = mimeType.split('/')[1]?.split(';')[0]?.trim().toLowerCase();
  if (subtype && /^[a-z0-9.+-]+$/.test(subtype)) {
    return subtype;
  }
  return 'png';
}

function resolveImageOutputPath(outputDir: string, imageIndex: number, extension: string): string {
  const baseName = `image-${imageIndex}`;
  let attempt = 0;
  while (true) {
    const suffix = attempt === 0 ? '' : `-${attempt}`;
    const candidate = path.join(outputDir, `${baseName}${suffix}.${extension}`);
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
    attempt += 1;
  }
}

function attemptPrintJson(value: unknown): boolean {
  if (value === undefined) {
    return false;
  }
  try {
    if (value === null) {
      console.log('null');
    } else {
      console.log(JSON.stringify(value, null, 2));
    }
    return true;
  } catch {
    return false;
  }
}

function printRaw(raw: unknown): void {
  if (typeof raw === 'string') {
    console.log(raw);
    return;
  }
  if (raw === null) {
    console.log('null');
    return;
  }
  if (raw === undefined) {
    console.log('undefined');
    return;
  }
  if (typeof raw === 'bigint') {
    console.log(raw.toString());
    return;
  }
  if (typeof raw === 'symbol' || typeof raw === 'function') {
    console.log(raw.toString());
    return;
  }
  // Keep nested payloads readable without unbounded inspect walks on huge objects.
  console.log(inspect(raw, { depth: RAW_INSPECT_DEPTH, maxStringLength: null, breakLength: 80 }));
}
