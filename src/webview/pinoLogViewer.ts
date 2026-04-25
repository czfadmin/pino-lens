import { LitElement, html, css, nothing } from 'lit';
import type { TemplateResult } from 'lit';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscodeApi = acquireVsCodeApi();

type LevelLabel =
  | 'trace'
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'fatal'
  | 'unknown';

interface PinoEntry {
  line: number;
  raw: string;
  levelLabel: LevelLabel;
  timestamp: string | undefined;
  msg: string | undefined;
  context: unknown;
  searchableText: string;
}

interface InvalidLineEntry {
  line: number;
  raw: string;
}

interface PinoState {
  fileName: string;
  entries: PinoEntry[];
  invalidLines: number[];
  invalidLineEntries: InvalidLineEntry[];
  invalidLineSample: string;
  totalLines: number;
  totalEntries: number;
  customLevelMap?: Record<number, string>;
}

interface AppendMessage {
  command: 'appendEntries';
  entries: PinoEntry[];
  invalidLines: number[];
  invalidLineEntries: InvalidLineEntry[];
  totalLines: number;
}

interface FollowStateMessage {
  command: 'followState';
  enabled: boolean;
}

interface FilterState {
  search: string;
  level: string;
  from: string;
  to: string;
  limit: number;
}

interface SavedPreset {
  name: string;
  filter: FilterState;
}

interface PresetsLoadedMessage {
  command: 'presetsLoaded';
  presets: SavedPreset[];
}

interface StreamChunkMessage {
  command: 'streamChunk';
  entries: PinoEntry[];
  progress: number;
  done: boolean;
}

type SearchMode = 'text' | 'regex' | 'compound';

interface QueryTerm {
  field: string | null;
  value: string;
  negate: boolean;
}

type QueryGroup = QueryTerm[];

type ColumnId = 'line' | 'level' | 'time' | 'message';

const ALL_COLUMNS: { id: ColumnId; label: string; width?: string }[] = [
  { id: 'line', label: 'Line', width: '72px' },
  { id: 'level', label: 'Level', width: '120px' },
  { id: 'time', label: 'Time', width: '180px' },
  { id: 'message', label: 'Message' },
];

type VisibleColumns = Record<ColumnId, boolean>;

const DEFAULT_COLUMNS: VisibleColumns = { line: true, level: true, time: true, message: true };

class PinoLogViewer extends LitElement {
  static override properties = {
    _search: { state: true },
    _level: { state: true },
    _from: { state: true },
    _to: { state: true },
    _limit: { state: true },
    _activeLine: { state: true },
    _filtered: { state: true },
    _data: { state: true },
    _showInvalidLines: { state: true },
    _paginated: { state: true },
    _pageSize: { state: true },
    _currentPage: { state: true },
    _followMode: { state: true },
    _visibleColumns: { state: true },
    _presets: { state: true },
    _presetName: { state: true },
    _searchMode: { state: true },
    _regexError: { state: true },
    _loadingProgress: { state: true },
    _customLevelMap: { state: true },
    _showStats: { state: true },
  };

  static override styles = css`
    :host {
      display: grid;
      gap: 8px;
      padding: 12px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      box-sizing: border-box;
    }

    * {
      box-sizing: border-box;
    }

    .toolbar-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 10px;
      border-bottom: 1px solid var(--vscode-editorWidget-border);
      background: color-mix(in srgb, var(--vscode-editorWidget-border) 14%, transparent);
      border-radius: 8px 8px 0 0;
      flex-wrap: wrap;
    }

    .toolbar-header .file-name {
      flex: 1;
      min-width: 60px;
      font-size: 12px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .toolbar-header .header-stats {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      opacity: 0.65;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .toolbar-header button {
      width: auto;
      flex-shrink: 0;
      padding: 3px 10px;
      font-size: 11px;
      margin-top: 0;
    }

    .toolbar {
      display: flex;
      flex-direction: column;
      padding: 0;
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 8px;
    }

    .toolbar-filters {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px 10px;
      border-bottom: 1px solid var(--vscode-editorWidget-border);
    }

    /* Row 1: search input + mode radios side by side */
    .filter-row-search {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .filter-row-search input[type='text'] {
      flex: 1;
      min-width: 160px;
      padding: 3px 6px;
      font-size: 12px;
    }

    /* Row 2: inline-label filter fields */
    .filter-row-fields {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 12px;
    }

    .filter-row-fields label {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
    }

    .filter-row-fields input,
    .filter-row-fields select {
      width: auto;
      padding: 3px 6px;
      font-size: 12px;
    }

    .filter-row-fields input[type='number'] {
      width: 72px;
    }

    .filter-row-fields input[type='datetime-local'] {
      width: 168px;
    }

    .filter-btns {
      display: flex;
      gap: 4px;
      margin-left: auto;
    }

    .filter-btns button {
      width: auto;
      padding: 3px 12px;
      font-size: 11px;
      margin-top: 0;
    }

    .toolbar-options {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 14px;
      padding: 6px 10px;
    }

    label {
      display: grid;
      gap: 4px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }

    input,
    select,
    button {
      width: 100%;
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 6px;
      padding: 6px 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font: inherit;
    }

    button {
      cursor: pointer;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      margin-top: auto;
    }

    .meta {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }

    .layout {
      display: grid;
      grid-template-columns: minmax(360px, 1fr) minmax(280px, 36%);
      gap: 12px;
      min-height: 60vh;
    }

    /* .panel is now defined with flex column in the pagination section below */

    .table-wrapper {
      overflow: auto;
      max-height: 68vh;
    }

    .truncation-notice {
      padding: 4px 8px;
      width: 100%;
      box-sizing: border-box;
      border-bottom: 1px solid var(--vscode-panel-border, #555);
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    thead {
      position: sticky;
      top: 0;
      background: var(--vscode-editor-background);
      z-index: 1;
    }

    th,
    td {
      text-align: left;
      padding: 8px;
      border-bottom: 1px solid var(--vscode-editorWidget-border);
      vertical-align: top;
      font-size: 12px;
    }

    tbody tr {
      cursor: pointer;
    }

    tbody tr:hover {
      background: color-mix(
        in srgb,
        var(--vscode-button-background) 12%,
        transparent
      );
    }

    tbody tr.active {
      background: color-mix(
        in srgb,
        var(--vscode-button-background) 22%,
        transparent
      );
    }

    tbody tr.invalid-row {
      background: color-mix(
        in srgb,
        var(--vscode-inputValidation-errorBackground, #5a1d1d) 30%,
        transparent
      );
      font-style: italic;
      opacity: 0.85;
    }

    tbody tr.invalid-row:hover {
      background: color-mix(
        in srgb,
        var(--vscode-inputValidation-errorBackground, #5a1d1d) 45%,
        transparent
      );
    }

    .toggle-label {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
    }

    .toggle-label input[type='checkbox'] {
      width: auto;
      cursor: pointer;
    }

    .badge {
      border-radius: 10px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      display: inline-block;
      min-width: 58px;
      text-align: center;
    }

    .level-trace {
      background: #61616133;
    }
    .level-debug {
      background: #0277bd33;
    }
    .level-info {
      background: #2e7d3233;
    }
    .level-warn {
      background: #f9a82533;
    }
    .level-error {
      background: #c6282833;
    }
    .level-fatal {
      background: #880e4f44;
    }
    .level-unknown {
      background: #7f8c8d33;
    }

    .detail {
      padding: 10px;
      display: grid;
      gap: 10px;
      height: 100%;
      align-content: start;
    }

    pre {
      margin: 0;
      padding: 10px;
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 6px;
      overflow: auto;
      background: color-mix(
        in srgb,
        var(--vscode-editor-background) 88%,
        var(--vscode-editor-foreground) 12%
      );
      max-height: 52vh;
      font-size: 12px;
      line-height: 1.35;
    }

    .empty {
      padding: 12px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }

    .panel {
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 8px;
      overflow: hidden;
      min-height: 240px;
      display: flex;
      flex-direction: column;
    }

    .pagination {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 6px 10px;
      border-top: 1px solid var(--vscode-editorWidget-border);
      font-size: 12px;
      flex-shrink: 0;
    }

    .pagination button {
      width: auto;
      padding: 4px 12px;
      margin-top: 0;
    }

    .pagination button:disabled {
      opacity: 0.4;
      cursor: default;
    }

    .pagination .page-info {
      min-width: 110px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
    }

    .page-size-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }

    .page-size-label input {
      width: 64px;
    }

    details.col-picker {
      font-size: 12px;
      position: relative;
    }

    details.col-picker summary {
      cursor: pointer;
      color: var(--vscode-descriptionForeground);
      user-select: none;
      padding: 4px 0;
      list-style: none;
      font-size: 12px;
    }

    details.col-picker summary::-webkit-details-marker,
    details.col-picker summary::marker {
      display: none;
    }

    details.col-picker summary::before {
      content: '▶ ';
      font-size: 10px;
    }

    details.col-picker[open] summary::before {
      content: '▼ ';
    }

    .col-picker-list {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      z-index: 20;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 6px;
      padding: 8px 12px;
      min-width: 160px;
      display: flex;
      flex-wrap: wrap;
      gap: 6px 16px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    }

    details.presets-picker {
      font-size: 12px;
      position: relative;
    }

    details.presets-picker summary {
      cursor: pointer;
      color: var(--vscode-descriptionForeground);
      user-select: none;
      padding: 4px 0;
      list-style: none;
      font-size: 12px;
    }

    details.presets-picker summary::-webkit-details-marker,
    details.presets-picker summary::marker {
      display: none;
    }

    details.presets-picker summary::before {
      content: '▶ ';
      font-size: 10px;
    }

    details.presets-picker[open] summary::before {
      content: '▼ ';
    }

    .presets-body {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      z-index: 20;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 6px;
      padding: 10px 12px;
      min-width: 300px;
      display: grid;
      gap: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    }

    .preset-save-row {
      display: flex;
      gap: 8px;
    }

    .preset-save-row input {
      flex: 1;
    }

    .preset-save-row button {
      width: auto;
      flex-shrink: 0;
      margin-top: 0;
    }

    .preset-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .preset-item {
      display: flex;
      align-items: center;
    }

    .preset-item .load-btn {
      width: auto;
      padding: 3px 10px;
      margin-top: 0;
      font-size: 11px;
      border-radius: 6px 0 0 6px;
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .preset-item .delete-btn {
      width: auto;
      padding: 3px 7px;
      margin-top: 0;
      font-size: 11px;
      border-radius: 0 6px 6px 0;
      background: color-mix(
        in srgb,
        var(--vscode-inputValidation-errorBackground, #5a1d1d) 80%,
        transparent
      );
    }

    .detail-tree {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }

    .detail-tree td {
      padding: 3px 6px;
      border-bottom: 1px solid
        color-mix(in srgb, var(--vscode-editorWidget-border) 40%, transparent);
      vertical-align: top;
    }

    .dt-key {
      color: var(--vscode-descriptionForeground);
      font-weight: 600;
      white-space: nowrap;
      min-width: 80px;
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .dt-val {
      word-break: break-all;
    }

    .dt-clickable {
      cursor: pointer;
      border-radius: 3px;
      padding: 1px 3px;
    }

    .dt-clickable:hover {
      background: color-mix(
        in srgb,
        var(--vscode-button-background) 20%,
        transparent
      );
      text-decoration: underline;
    }

    @media (max-width: 980px) {
      .layout {
        grid-template-columns: 1fr;
      }
    }

    .progress-bar-wrap {
      height: 4px;
      background: color-mix(in srgb, var(--vscode-editorWidget-border) 60%, transparent);
      border-radius: 2px;
      overflow: hidden;
      margin-bottom: 4px;
    }

    .progress-bar {
      height: 100%;
      background: var(--vscode-button-background);
      transition: width 0.2s ease;
    }

    .search-mode-row {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-shrink: 0;
    }

    .search-mode-row label {
      display: flex;
      align-items: center;
      gap: 3px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      white-space: nowrap;
    }

    .search-mode-row input[type='radio'] {
      width: auto;
      margin: 0;
    }

    .search-extras {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .regex-error {
      font-size: 11px;
      color: var(--vscode-inputValidation-errorForeground, #f44747);
      padding: 2px 0;
    }

    .search-hint {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      opacity: 0.7;
      padding: 2px 0;
      line-height: 1.4;
    }

    /* Stats panel */
    .stats-panel {
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 8px;
      padding: 12px 16px;
      display: grid;
      gap: 16px;
    }

    .stats-panel h3 {
      margin: 0;
      font-size: 12px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .stats-charts {
      display: grid;
      grid-template-columns: minmax(220px, 340px) 1fr;
      gap: 24px;
      align-items: start;
    }

    @media (max-width: 780px) {
      .stats-charts {
        grid-template-columns: 1fr;
      }
    }

    .stats-section-title {
      font-size: 11px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 8px;
      opacity: 0.8;
    }

    /* Level distribution bars */
    .level-bars {
      display: grid;
      gap: 5px;
    }

    .level-bar-row {
      display: grid;
      grid-template-columns: 58px 1fr 40px;
      align-items: center;
      gap: 8px;
      font-size: 11px;
    }

    .level-bar-label {
      text-align: right;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      text-transform: uppercase;
      font-weight: 600;
      opacity: 0.8;
    }

    .level-bar-track {
      height: 14px;
      border-radius: 3px;
      background: color-mix(in srgb, var(--vscode-editorWidget-border) 40%, transparent);
      overflow: hidden;
    }

    .level-bar-fill {
      height: 100%;
      border-radius: 3px;
      min-width: 2px;
      transition: width 0.3s ease;
    }

    .level-bar-count {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      text-align: right;
    }

    /* Timeline chart */
    .timeline-wrap {
      overflow-x: auto;
    }

    .timeline-chart {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      height: 80px;
      min-width: 0;
    }

    .timeline-col {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      min-width: 4px;
      cursor: default;
    }

    .timeline-seg {
      width: 100%;
      min-height: 1px;
    }

    .timeline-labels {
      display: flex;
      justify-content: space-between;
      margin-top: 4px;
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      opacity: 0.7;
    }
  `;

  // Pending filter state — bound to toolbar controls; only applied on Confirm
  _search = '';
  _level = '';
  _from = '';
  _to = '';
  _limit = 1000;

  // Display state
  _activeLine: number | undefined = undefined;
  _filtered: PinoEntry[] = [];
  _showInvalidLines = false;

  // Pagination state
  _paginated = false;
  _pageSize = 100;
  _currentPage = 0;

  // Follow mode
  _followMode = false;

  // Column visibility
  _visibleColumns: VisibleColumns = { ...DEFAULT_COLUMNS };

  // Saved presets
  _presets: SavedPreset[] = [];
  _presetName = '';

  // Search mode: 'text' | 'regex' | 'compound'
  _searchMode: SearchMode = 'text';
  _regexError: string | undefined = undefined;

  // Streaming progress (null = not streaming / done)
  _loadingProgress: number | null = null;

  // Custom level map from extension host
  _customLevelMap: Record<number, string> = {};

  // Stats panel visibility
  _showStats = false;

  private _data: PinoState = {
    fileName: '',
    entries: [],
    invalidLines: [],
    invalidLineEntries: [],
    invalidLineSample: '',
    totalLines: 0,
    totalEntries: 0,
  };

  constructor() {
    super();
    const scriptTag = document.getElementById('pinoInitialData');
    const raw = scriptTag?.textContent ?? '{}';
    const initialPayload = JSON.parse(raw) as PinoState & { presets?: SavedPreset[] };
    this._data = { ...initialPayload, totalEntries: initialPayload.totalEntries ?? initialPayload.entries.length };
    this._filtered = this._data.entries;
    this._presets = initialPayload.presets ?? [];
    this._customLevelMap = initialPayload.customLevelMap ?? {};
    // If more entries are coming via streaming, show progress
    if ((initialPayload.totalEntries ?? 0) > initialPayload.entries.length) {
      this._loadingProgress = Math.round(initialPayload.entries.length / initialPayload.totalEntries * 100);
    }

    window.addEventListener('message', (e: MessageEvent) => {
      const msg = e.data as
        | { command: string; state?: PinoState }
        | AppendMessage
        | FollowStateMessage
        | PresetsLoadedMessage
        | StreamChunkMessage;
      if (msg.command === 'fileLoaded' && 'state' in msg && msg.state) {
        const st = msg.state;
        this._data = { ...st, totalEntries: st.totalEntries ?? st.entries.length };
        this._filtered = st.entries;
        this._activeLine = undefined;
        this._search = '';
        this._level = '';
        this._from = '';
        this._to = '';
        this._limit = 1000;
        this._currentPage = 0;
        this._followMode = false;
        this._customLevelMap = st.customLevelMap ?? {};
        if ((st.totalEntries ?? 0) > st.entries.length) {
          this._loadingProgress = Math.round(st.entries.length / st.totalEntries * 100);
        } else {
          this._loadingProgress = null;
        }
        return;
      }
      if (msg.command === 'streamChunk') {
        const chunk = msg as StreamChunkMessage;
        this._data = {
          ...this._data,
          entries: [...this._data.entries, ...chunk.entries],
        };
        const newMatches = this._applyFiltersOn(chunk.entries);
        if (newMatches.length > 0) {
          this._filtered = [...this._filtered, ...newMatches];
        }
        this._loadingProgress = chunk.done ? null : chunk.progress;
        return;
      }
      if (msg.command === 'appendEntries') {
        const append = msg as AppendMessage;
        this._data = {
          ...this._data,
          entries: [...this._data.entries, ...append.entries],
          invalidLines: [...this._data.invalidLines, ...append.invalidLines],
          invalidLineEntries: [...this._data.invalidLineEntries, ...append.invalidLineEntries],
          totalLines: append.totalLines,
        };
        // Re-apply current filters on new entries and append matching ones
        const newMatches = this._applyFiltersOn(append.entries);
        if (newMatches.length > 0) {
          this._filtered = [...this._filtered, ...newMatches];
        }
        if (this._followMode) {
          this._scrollToBottom();
        }
        return;
      }
      if (msg.command === 'presetsLoaded') {
        this._presets = (msg as PresetsLoadedMessage).presets;
        return;
      }
      if (msg.command === 'followState') {
        this._followMode = (msg as FollowStateMessage).enabled;
        if (this._followMode) {
          this._scrollToBottom();
        }
      }
    });
  }

  private _openFile(): void {
    vscodeApi.postMessage({ command: 'openFile' });
  }

  private _exportFiltered(format: 'ndjson' | 'json'): void {
    const lines = this._filtered.map((e) => e.raw);
    vscodeApi.postMessage({ command: 'exportFiltered', format, lines });
  }

  private _toMillis(value: string): number | undefined {
    if (!value) {
      return undefined;
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  private _applyFiltersOn(entries: PinoEntry[]): PinoEntry[] {
    const query = this._search.trim();
    const queryLower = query.toLowerCase();
    const level = this._level;
    const fromMillis = this._toMillis(this._from);
    const toMillisValue = this._toMillis(this._to);

    // Build search matcher based on mode
    let searchMatcher: ((entry: PinoEntry) => boolean) | null = null;
    if (query) {
      if (this._searchMode === 'regex') {
        try {
          const re = new RegExp(query, 'i');
          this._regexError = undefined;
          searchMatcher = (e) => re.test(e.searchableText);
        } catch (err) {
          this._regexError = (err as Error).message;
          searchMatcher = () => false;
        }
      } else if (this._searchMode === 'compound') {
        const groups = this._parseCompoundQuery(query);
        searchMatcher = (e) => this._matchesCompound(e, groups);
      } else {
        // text mode
        searchMatcher = (e) => e.searchableText.includes(queryLower);
      }
    }

    return entries.filter((entry) => {
      if (searchMatcher && !searchMatcher(entry)) {
        return false;
      }
      if (level && entry.levelLabel !== level) {
        return false;
      }
      if (fromMillis !== undefined || toMillisValue !== undefined) {
        const ts = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
        if (!Number.isNaN(ts)) {
          if (fromMillis !== undefined && ts < fromMillis) {
            return false;
          }
          if (toMillisValue !== undefined && ts > toMillisValue) {
            return false;
          }
        }
      }
      return true;
    });
  }

  /**
   * Parse a compound query string into OR-groups of AND-terms.
   * Supports: `field:value`, `-term` (negate), `term1 OR term2`, and bare text terms.
   * Multiple space-separated tokens within a group are ANDed.
   */
  private _parseCompoundQuery(raw: string): QueryGroup[] {
    const orParts = raw.split(/\bOR\b/i).map((p) => p.trim()).filter((p) => p.length > 0);
    return orParts.map((part) => {
      const terms: QueryTerm[] = [];
      // Tokenise: handle field:value, -negated, and bare tokens
      const tokenRe = /(-?)([A-Za-z_][\w.]*):(\S+)|(-?)("([^"]+)"|(\S+))/g;
      let m: RegExpExecArray | null;
      while ((m = tokenRe.exec(part)) !== null) {
        if (m[2] !== undefined) {
          // field:value
          terms.push({ field: m[2].toLowerCase(), value: m[3], negate: m[1] === '-' });
        } else {
          const negate = m[4] === '-';
          const value = m[6] ?? m[7] ?? '';
          if (value && value.toUpperCase() !== 'OR') {
            terms.push({ field: null, value, negate });
          }
        }
      }
      return terms;
    }).filter((g) => g.length > 0);
  }

  private _matchesCompound(entry: PinoEntry, groups: QueryGroup[]): boolean {
    if (groups.length === 0) {
      return true;
    }
    const ctx = entry.context as Record<string, unknown>;
    // OR between groups, AND within each group
    return groups.some((group) =>
      group.every((term) => {
        let hit: boolean;
        if (term.field) {
          if (term.field === 'level') {
            hit = entry.levelLabel.toLowerCase() === term.value.toLowerCase();
          } else {
            const fieldVal = String(ctx[term.field] ?? '').toLowerCase();
            hit = fieldVal.includes(term.value.toLowerCase());
          }
        } else {
          hit = entry.searchableText.includes(term.value.toLowerCase());
        }
        return term.negate ? !hit : hit;
      }),
    );
  }

  private get _levelOptions(): string[] {
    const custom = Object.values(this._customLevelMap);
    return [...new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'unknown', ...custom])];
  }

  private _applyFilters(): PinoEntry[] {
    return this._applyFiltersOn(this._data.entries);
  }

  private _confirm(): void {
    this._filtered = this._applyFilters();
    this._activeLine = undefined;
    this._currentPage = 0;
  }

  private _reset(): void {
    this._search = '';
    this._level = '';
    this._from = '';
    this._to = '';
    this._limit = 1000;
    this._activeLine = undefined;
    this._filtered = this._data.entries;
    this._showInvalidLines = false;
    this._currentPage = 0;
    this._regexError = undefined;
  }

  private _toggleFollow(): void {
    vscodeApi.postMessage({ command: 'toggleFollow' });
  }

  private _scrollToBottom(): void {
    // Use requestAnimationFrame so Lit has time to render the new rows first
    requestAnimationFrame(() => {
      const wrapper = this.shadowRoot?.querySelector('.table-wrapper');
      if (wrapper) {
        wrapper.scrollTop = wrapper.scrollHeight;
      }
    });
  }

  private _showDetail(entry: PinoEntry): void {
    this._activeLine = entry.line;
  }

  private get _activeEntry(): PinoEntry | undefined {
    return this._data.entries.find((e) => e.line === this._activeLine);
  }

  private _normalizeLimit(raw: string): number {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
      return 1000;
    }
    return Math.max(50, Math.min(10000, parsed));
  }

  private _normalizePageSize(raw: string): number {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
      return 100;
    }
    return Math.max(10, Math.min(1000, parsed));
  }

  private _renderRows(shown: Array<{ kind: 'entry'; entry: PinoEntry } | { kind: 'invalid'; entry: InvalidLineEntry }>): TemplateResult[] {
    const cols = this._visibleColumns;
    return shown.map((row) => {
      if (row.kind === 'invalid') {
        return html`
          <tr class="invalid-row">
            ${cols.line ? html`<td>${row.entry.line}</td>` : nothing}
            ${cols.level ? html`<td><span class="badge level-unknown">invalid</span></td>` : nothing}
            ${cols.time ? html`<td>-</td>` : nothing}
            ${cols.message ? html`<td>${row.entry.raw}</td>` : nothing}
          </tr>
        `;
      }
      const entry = row.entry;
      return html`
        <tr
          class=${this._activeLine === entry.line ? 'active' : ''}
          @click=${() => this._showDetail(entry)}
        >
          ${cols.line ? html`<td>${entry.line}</td>` : nothing}
          ${cols.level ? html`<td><span class="badge level-${entry.levelLabel || 'unknown'}">${entry.levelLabel || 'unknown'}</span></td>` : nothing}
          ${cols.time ? html`<td>${entry.timestamp || '-'}</td>` : nothing}
          ${cols.message ? html`<td>${entry.msg || '-'}</td>` : nothing}
        </tr>
      `;
    });
  }

  private _toggleColumn(id: ColumnId): void {
    this._visibleColumns = { ...this._visibleColumns, [id]: !this._visibleColumns[id] };
  }

  private _savePreset(): void {
    const name = this._presetName.trim();
    if (!name) {
      return;
    }
    const filter: FilterState = {
      search: this._search,
      level: this._level,
      from: this._from,
      to: this._to,
      limit: this._limit,
    };
    vscodeApi.postMessage({ command: 'savePreset', name, filter });
    this._presetName = '';
  }

  private _loadPreset(preset: SavedPreset): void {
    this._search = preset.filter.search;
    this._level = preset.filter.level;
    this._from = preset.filter.from;
    this._to = preset.filter.to;
    this._limit = preset.filter.limit;
    this._confirm();
  }

  private _deletePreset(name: string): void {
    vscodeApi.postMessage({ command: 'deletePreset', name });
  }

  private _quickFilter(value: unknown): void {
    this._search = value === null ? 'null' : String(value);
    this._confirm();
  }

  private _renderDetailTree(context: unknown): TemplateResult {
    const record =
      context !== null && typeof context === 'object' && !Array.isArray(context)
        ? (context as Record<string, unknown>)
        : {};
    const entries = Object.entries(record);
    if (entries.length === 0) {
      return html`<div class="empty">No payload data.</div>`;
    }
    return html`
      <div style="overflow:auto;max-height:46vh;">
        <table class="detail-tree">
          ${entries.map(([key, val]) => {
            const isPrimitive = val === null || typeof val !== 'object';
            const full = isPrimitive ? String(val) : JSON.stringify(val);
            const display = full.length > 120 ? full.slice(0, 120) + '\u2026' : full;
            const filterVal = isPrimitive ? val : full;
            return html`
              <tr>
                <td class="dt-key" title=${key}>${key}</td>
                <td class="dt-val">
                  <span
                    class="dt-clickable"
                    title="Click to quick-filter by this value"
                    @click=${() => this._quickFilter(filterVal)}
                  >${display}</span>
                </td>
              </tr>
            `;
          })}
        </table>
      </div>
    `;
  }

  // ── Stats helpers ───────────────────────────────────────────────

  /** Count entries per level label from the current filtered set. */
  private _levelCounts(): Map<string, number> {
    const map = new Map<string, number>();
    for (const e of this._filtered) {
      map.set(e.levelLabel, (map.get(e.levelLabel) ?? 0) + 1);
    }
    return map;
  }

  /**
   * Bucket filtered entries into N time buckets using their timestamp.
   * Returns an array of per-bucket level counts for stacking.
   */
  private _timelineBuckets(bucketCount = 40): Array<Record<string, number>> {
    const entries = this._filtered.filter((e) => !!e.timestamp);
    if (entries.length < 2) {
      return [];
    }
    const times = entries.map((e) => Date.parse(e.timestamp!));
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const span = maxT - minT;
    if (span <= 0) {
      return [];
    }
    const buckets: Array<Record<string, number>> = Array.from({ length: bucketCount }, () => ({}));
    for (let i = 0; i < entries.length; i++) {
      const idx = Math.min(
        bucketCount - 1,
        Math.floor(((times[i] - minT) / span) * bucketCount),
      );
      const lbl = entries[i].levelLabel;
      buckets[idx][lbl] = (buckets[idx][lbl] ?? 0) + 1;
    }
    return buckets;
  }

  /** Color for a level label (matches CSS badge colors). */
  private _levelColor(label: string): string {
    const colors: Record<string, string> = {
      trace: '#616161',
      debug: '#0277bd',
      info: '#2e7d32',
      warn: '#f9a825',
      error: '#c62828',
      fatal: '#880e4f',
    };
    return colors[label] ?? '#7f8c8d';
  }

  private _renderStats(): TemplateResult {
    const levelCounts = this._levelCounts();
    const total = this._filtered.length;
    const orderedLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];
    // Include any custom levels found in filtered set
    const allLevels = [
      ...orderedLevels,
      ...[...levelCounts.keys()].filter((k) => !orderedLevels.includes(k)),
    ].filter((l) => levelCounts.has(l));

    const maxCount = Math.max(...[...levelCounts.values()], 1);

    const buckets = this._timelineBuckets(40);
    const bucketMax = buckets.reduce((m, b) => Math.max(m, Object.values(b).reduce((s, n) => s + n, 0)), 1);

    // Determine time range labels for timeline axis
    const tsEntries = this._filtered.filter((e) => !!e.timestamp);
    const timeLabel = (isoStr: string | undefined): string => {
      if (!isoStr) { return ''; }
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) { return ''; }
      return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    };
    const firstTs = tsEntries[0]?.timestamp;
    const lastTs = tsEntries[tsEntries.length - 1]?.timestamp;

    return html`
      <section class="stats-panel">
        <h3>Log Statistics — ${total} matched entries</h3>
        <div class="stats-charts">
          <!-- Level distribution -->
          <div>
            <div class="stats-section-title">Level distribution</div>
            <div class="level-bars">
              ${allLevels.length === 0
                ? html`<div class="empty">No data.</div>`
                : allLevels.map((lbl) => {
                    const count = levelCounts.get(lbl) ?? 0;
                    const pct = Math.max(2, Math.round((count / maxCount) * 100));
                    return html`
                      <div class="level-bar-row">
                        <span class="level-bar-label">${lbl}</span>
                        <div class="level-bar-track">
                          <div
                            class="level-bar-fill"
                            style="width:${pct}%;background:${this._levelColor(lbl)};"
                          ></div>
                        </div>
                        <span class="level-bar-count">${count}</span>
                      </div>
                    `;
                  })}
            </div>
          </div>

          <!-- Timeline -->
          <div>
            <div class="stats-section-title">Event frequency over time</div>
            ${buckets.length === 0
              ? html`<div class="empty">No timestamp data to chart.</div>`
              : html`
                <div class="timeline-wrap">
                  <div class="timeline-chart">
                    ${buckets.map((bucket) => {
                      const bucketTotal = Object.values(bucket).reduce((s, n) => s + n, 0);
                      const totalH = Math.round((bucketTotal / bucketMax) * 80);
                      // Stack segments for each level present
                      const segs = orderedLevels
                        .filter((l) => (bucket[l] ?? 0) > 0)
                        .map((l) => {
                          const h = Math.max(1, Math.round((bucket[l] / bucketTotal) * totalH));
                          return html`<div class="timeline-seg" style="height:${h}px;background:${this._levelColor(l)};opacity:0.85;" title="${l}: ${bucket[l]}"></div>`;
                        });
                      return html`<div class="timeline-col" style="height:${totalH}px;">${segs}</div>`;
                    })}
                  </div>
                  <div class="timeline-labels">
                    <span>${timeLabel(firstTs)}</span>
                    <span>${timeLabel(lastTs)}</span>
                  </div>
                </div>
              `}
          </div>
        </div>
      </section>
    `;
  }

  override render(): TemplateResult {
    type DisplayRow =
      | { kind: 'entry'; entry: PinoEntry }
      | { kind: 'invalid'; entry: InvalidLineEntry };

    let rows: DisplayRow[] = this._filtered.map((e) => ({
      kind: 'entry' as const,
      entry: e,
    }));

    if (this._showInvalidLines) {
      const invalidRows: DisplayRow[] = (
        this._data.invalidLineEntries ?? []
      ).map((e) => ({ kind: 'invalid' as const, entry: e }));
      rows = [...rows, ...invalidRows].sort(
        (a, b) => a.entry.line - b.entry.line,
      );
    }

    // Determine which slice of rows to show
    let shown: DisplayRow[];
    let paginationBar: TemplateResult | typeof nothing = nothing;
    let truncationRow: TemplateResult | typeof nothing = nothing;

    if (this._paginated) {
      const totalPages = Math.max(1, Math.ceil(rows.length / this._pageSize));
      const page = Math.min(this._currentPage, totalPages - 1);
      const start = page * this._pageSize;
      shown = rows.slice(start, start + this._pageSize);
      paginationBar = html`
        <div class="pagination">
          <button
            type="button"
            ?disabled=${page === 0}
            @click=${() => {
              this._currentPage = 0;
            }}
          >«</button>
          <button
            type="button"
            ?disabled=${page === 0}
            @click=${() => {
              this._currentPage = Math.max(0, page - 1);
            }}
          >‹ Prev</button>
          <span class="page-info">Page ${page + 1} / ${totalPages}</span>
          <button
            type="button"
            ?disabled=${page >= totalPages - 1}
            @click=${() => {
              this._currentPage = Math.min(totalPages - 1, page + 1);
            }}
          >Next ›</button>
          <button
            type="button"
            ?disabled=${page >= totalPages - 1}
            @click=${() => {
              this._currentPage = totalPages - 1;
            }}
          >»</button>
          <label class="page-size-label">
            Rows/page
            <input
              type="number"
              min="10"
              max="1000"
              step="10"
              .value=${String(this._pageSize)}
              @change=${(e: Event) => {
                this._pageSize = this._normalizePageSize(
                  (e.target as HTMLInputElement).value,
                );
                this._currentPage = 0;
              }}
            />
          </label>
        </div>
      `;
    } else {
      shown = rows.slice(0, this._limit);
      truncationRow =
        rows.length > shown.length
          ? html`
              <div class="truncation-notice">
                Showing first ${shown.length} of ${rows.length} matched rows.
                Increase Max rows or enable pagination.
              </div>`
          : nothing;
    }

    const active = this._activeEntry;

    const invalidSummary =
      this._data.invalidLines.length > 0
        ? ` (${this._data.invalidLineSample})`
        : '';

    const detailHeader = active
      ? `Line ${active.line} | ${active.levelLabel.toUpperCase()} | ${active.timestamp ?? 'N/A'}`
      : 'Select a row to inspect the full JSON payload.';

    const tableBody = html`${this._renderRows(shown)}`;

    return html`
      ${this._loadingProgress !== null
        ? html`
          <div class="progress-bar-wrap">
            <div class="progress-bar" style="width:${this._loadingProgress}%"></div>
          </div>
        `
        : nothing}

      <section class="toolbar">
        <div class="toolbar-header">
          <span class="file-name">${this._data.fileName || 'No file loaded'}</span>
          <span class="header-stats">
            ${this._data.entries.length} entries${this._loadingProgress !== null ? html` <em>(loading…)</em>` : nothing}
            &nbsp;|&nbsp; matched: ${this._filtered.length}
            &nbsp;|&nbsp; invalid: ${this._data.invalidLines.length}
          </span>
          <button type="button" @click=${this._openFile}>Open File…</button>
          <button type="button" @click=${() => this._exportFiltered('ndjson')} ?disabled=${this._filtered.length === 0}>Export NDJSON</button>
          <button type="button" @click=${() => this._exportFiltered('json')} ?disabled=${this._filtered.length === 0}>Export JSON</button>
        </div>

        <div class="toolbar-filters">
          <!-- Row 1: search input + mode selector on same line -->
          <div class="filter-row-search">
            <input
              type="text"
              .value=${this._search}
              @input=${(e: Event) => {
                this._search = (e.target as HTMLInputElement).value;
              }}
              placeholder=${this._searchMode === 'compound'
                ? 'level:error service:api OR msg:failed -debug'
                : this._searchMode === 'regex'
                ? 'regex pattern, e.g. err(or)?'
                : 'message / key / value'}
            />
            <div class="search-mode-row">
              ${(['text', 'regex', 'compound'] as SearchMode[]).map(
                (m) => html`
                  <label>
                    <input
                      type="radio"
                      name="search-mode"
                      .value=${m}
                      .checked=${this._searchMode === m}
                      @change=${() => {
                        this._searchMode = m;
                        this._regexError = undefined;
                      }}
                    />${m}
                  </label>
                `,
              )}
            </div>
          </div>
          ${this._regexError || this._searchMode === 'compound'
            ? html`<div class="search-extras">
                ${this._regexError ? html`<div class="regex-error">⚠ ${this._regexError}</div>` : nothing}
                ${this._searchMode === 'compound' ? html`<div class="search-hint">field:val  -exclude  OR  e.g. level:error service:api</div>` : nothing}
              </div>`
            : nothing}

          <!-- Row 2: other filter fields + apply/reset, label and input inline -->
          <div class="filter-row-fields">
            <label>Level
              <select
                .value=${this._level}
                @change=${(e: Event) => {
                  this._level = (e.target as HTMLSelectElement).value;
                }}
              >
                <option value="">All</option>
                ${this._levelOptions.map((l) => html`<option value=${l}>${l}</option>`)}
              </select>
            </label>

            <label>From
              <input
                type="datetime-local"
                .value=${this._from}
                @change=${(e: Event) => {
                  this._from = (e.target as HTMLInputElement).value;
                }}
              />
            </label>

            <label>To
              <input
                type="datetime-local"
                .value=${this._to}
                @change=${(e: Event) => {
                  this._to = (e.target as HTMLInputElement).value;
                }}
              />
            </label>

            <label>Max rows
              <input
                type="number"
                min="50"
                max="10000"
                step="50"
                .value=${String(this._limit)}
                ?disabled=${this._paginated}
                @change=${(e: Event) => {
                  this._limit = this._normalizeLimit(
                    (e.target as HTMLInputElement).value,
                  );
                }}
              />
            </label>

            <div class="filter-btns">
              <button type="button" @click=${this._confirm}>Apply</button>
              <button type="button" @click=${this._reset}>Reset</button>
            </div>
          </div>
        </div>

        <div class="toolbar-options">
          <label class="toggle-label">
            <input
              type="checkbox"
              .checked=${this._showInvalidLines}
              @change=${(e: Event) => {
                this._showInvalidLines = (e.target as HTMLInputElement).checked;
              }}
            />
            Show invalid (${this._data.invalidLines.length})
          </label>

          <label class="toggle-label">
            <input
              type="checkbox"
              .checked=${this._paginated}
              @change=${(e: Event) => {
                this._paginated = (e.target as HTMLInputElement).checked;
                this._currentPage = 0;
              }}
            />
            Pagination
          </label>

          <label class="toggle-label">
            <input
              type="checkbox"
              .checked=${this._followMode}
              @change=${this._toggleFollow}
            />
            Follow
          </label>

          <label class="toggle-label">
            <input
              type="checkbox"
              .checked=${this._showStats}
              @change=${(e: Event) => {
                this._showStats = (e.target as HTMLInputElement).checked;
              }}
            />
            Statistics
          </label>

          <details class="col-picker">
            <summary>Columns</summary>
            <div class="col-picker-list">
              ${ALL_COLUMNS.map(
                (col) => html`
                  <label class="toggle-label">
                    <input
                      type="checkbox"
                      .checked=${this._visibleColumns[col.id]}
                      @change=${() => this._toggleColumn(col.id)}
                    />
                    ${col.label}
                  </label>
                `,
              )}
            </div>
          </details>

          <details class="presets-picker">
            <summary>Presets</summary>
            <div class="presets-body">
              <div class="preset-save-row">
                <input
                  type="text"
                  .value=${this._presetName}
                  @input=${(e: Event) => {
                    this._presetName = (e.target as HTMLInputElement).value;
                  }}
                  placeholder="Preset name…"
                />
                <button
                  type="button"
                  ?disabled=${!this._presetName.trim()}
                  @click=${this._savePreset}
                >Save</button>
              </div>
              ${this._presets.length === 0
                ? html`<div class="empty">No saved presets yet.</div>`
                : html`
                  <div class="preset-list">
                    ${this._presets.map(
                      (p) => html`
                        <div class="preset-item">
                          <button
                            type="button"
                            class="load-btn"
                            title=${p.name}
                            @click=${() => this._loadPreset(p)}
                          >${p.name}</button>
                          <button
                            type="button"
                            class="delete-btn"
                            title="Delete preset"
                            @click=${() => this._deletePreset(p.name)}
                          >×</button>
                        </div>
                      `,
                    )}
                  </div>
                `}
            </div>
          </details>
        </div>
      </section>

      ${this._showStats ? this._renderStats() : nothing}

      <section class="layout">
        <div class="panel">
          <div
            class="table-wrapper"
          >
            ${truncationRow}
            <table>
              <thead>
                <tr>
                  ${ALL_COLUMNS.map((col) =>
                    this._visibleColumns[col.id]
                      ? html`<th style=${col.width ? `width:${col.width};` : ''}>${col.label}</th>`
                      : nothing,
                  )}
                </tr>
              </thead>
              <tbody>
                ${tableBody}
              </tbody>
            </table>
            ${shown.length === 0
              ? html`<div class="empty">No logs matched current filters.</div>`
              : nothing}
          </div>
          ${paginationBar}
        </div>

        <div class="panel detail">
          <div class="meta">${detailHeader}</div>
          ${active ? this._renderDetailTree(active.context) : nothing}
        </div>
      </section>
    `;
  }
}

customElements.define('pino-log-viewer', PinoLogViewer);
