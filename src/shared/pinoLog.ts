export interface PinoLogEntry {
  line: number;
  raw: string;
  level?: number;
  levelLabel: string;
  timestamp?: string;
  msg: string;
  context: Record<string, unknown>;
  searchableText: string;
}

export interface InvalidLineEntry {
  line: number;
  raw: string;
}

export interface PinoParseResult {
  entries: PinoLogEntry[];
  invalidLines: number[];
  invalidLineEntries: InvalidLineEntry[];
  totalLines: number;
}

export const DEFAULT_LEVEL_LABELS: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

function pickTimestamp(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const asDate = new Date(value);
    if (!Number.isNaN(asDate.getTime())) {
      return asDate.toISOString();
    }
    return value;
  }

  return undefined;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

function normalizeMessage(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value === undefined || value === null) {
    return '';
  }

  return safeStringify(value);
}

function makeEntry(
  asRecord: Record<string, unknown>,
  lineNumber: number,
  rawText: string,
  levelMap: Record<number, string>,
): PinoLogEntry {
  const level = typeof asRecord.level === 'number' ? asRecord.level : undefined;
  const levelLabel =
    level !== undefined && levelMap[level] ? levelMap[level] : 'unknown';
  const timestamp = pickTimestamp(asRecord.time ?? asRecord.timestamp);
  const msg = normalizeMessage(asRecord.msg ?? asRecord.message);
  return {
    line: lineNumber,
    raw: rawText,
    level,
    levelLabel,
    timestamp,
    msg,
    context: asRecord,
    searchableText: `${msg} ${safeStringify(asRecord)}`.toLowerCase(),
  };
}

export function parsePinoDocument(content: string, customLevels?: Record<number, string>): PinoParseResult {
  const levelMap: Record<number, string> = { ...DEFAULT_LEVEL_LABELS, ...customLevels };
  const entries: PinoLogEntry[] = [];
  const invalidLines: number[] = [];
  const invalidLineEntries: InvalidLineEntry[] = [];

  // Detect JSON array format (e.g. exported log files as a JSON array)
  const trimmed = content.trim();
  if (trimmed.startsWith('[')) {
    try {
      const arr: unknown = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        arr.forEach((item, index) => {
          const lineNumber = index + 1;
          const raw = safeStringify(item);
          const asRecord = toRecord(item);
          if (Object.keys(asRecord).length === 0) {
            invalidLines.push(lineNumber);
            invalidLineEntries.push({ line: lineNumber, raw });
          } else {
            entries.push(makeEntry(asRecord, lineNumber, raw, levelMap));
          }
        });
        return {
          entries,
          invalidLines,
          invalidLineEntries,
          totalLines: arr.length,
        };
      }
    } catch {
      // Not a valid JSON array — fall through to line-by-line parsing
    }
  }

  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (raw.trim().length === 0) {
      continue;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      const asRecord = toRecord(parsed);
      if (Object.keys(asRecord).length === 0) {
        invalidLines.push(index + 1);
        invalidLineEntries.push({ line: index + 1, raw });
        continue;
      }

      entries.push(makeEntry(asRecord, index + 1, raw, levelMap));
    } catch {
      invalidLines.push(index + 1);
      invalidLineEntries.push({ line: index + 1, raw });
    }
  }

  return {
    entries,
    invalidLines,
    invalidLineEntries,
    totalLines: lines.length,
  };
}

/**
 * Parse an incremental chunk of text appended to an existing log file.
 * `lineOffset` should be the number of lines already parsed (so that line
 * numbers in the returned entries continue from where the previous parse left
 * off).
 */
export function parsePinoLines(content: string, lineOffset: number, customLevels?: Record<number, string>): PinoParseResult {
  const levelMap: Record<number, string> = { ...DEFAULT_LEVEL_LABELS, ...customLevels };
  const lines = content.split(/\r?\n/);
  const entries: PinoLogEntry[] = [];
  const invalidLines: number[] = [];
  const invalidLineEntries: InvalidLineEntry[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (raw.trim().length === 0) {
      continue;
    }

    const absoluteLine = lineOffset + index;

    try {
      const parsed: unknown = JSON.parse(raw);
      const asRecord = toRecord(parsed);
      if (Object.keys(asRecord).length === 0) {
        invalidLines.push(absoluteLine);
        invalidLineEntries.push({ line: absoluteLine, raw });
        continue;
      }

      entries.push(makeEntry(asRecord, absoluteLine, raw, levelMap));
    } catch {
      invalidLines.push(absoluteLine);
      invalidLineEntries.push({ line: absoluteLine, raw });
    }
  }

  return {
    entries,
    invalidLines,
    invalidLineEntries,
    totalLines: lines.length,
  };
}
