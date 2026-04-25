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
  };

  static override styles = css`
    :host {
      display: grid;
      gap: 12px;
      padding: 12px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      box-sizing: border-box;
    }

    * {
      box-sizing: border-box;
    }

    .file-bar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 8px;
    }

    .file-bar .file-name {
      flex: 1;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-bar button {
      width: auto;
      flex-shrink: 0;
    }

    .toolbar {
      display: grid;
      gap: 8px;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      padding: 10px;
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 8px;
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
      grid-column: 1 / -1;
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
      display: flex;
      flex-wrap: wrap;
      gap: 6px 16px;
      padding: 8px 0 4px;
    }

    details.presets-picker {
      font-size: 12px;
      grid-column: 1 / -1;
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
      display: grid;
      gap: 8px;
      padding: 8px 0 4px;
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

  private _data: PinoState = {
    fileName: '',
    entries: [],
    invalidLines: [],
    invalidLineEntries: [],
    invalidLineSample: '',
    totalLines: 0,
  };

  constructor() {
    super();
    const scriptTag = document.getElementById('pinoInitialData');
    const raw = scriptTag?.textContent ?? '{}';
    const initialPayload = JSON.parse(raw) as PinoState & { presets?: SavedPreset[] };
    this._data = initialPayload;
    this._filtered = this._data.entries;
    this._presets = initialPayload.presets ?? [];

    window.addEventListener('message', (e: MessageEvent) => {
      const msg = e.data as { command: string; state?: PinoState } | AppendMessage | FollowStateMessage | PresetsLoadedMessage;
      if (msg.command === 'fileLoaded' && 'state' in msg && msg.state) {
        this._data = msg.state;
        this._filtered = msg.state.entries;
        this._activeLine = undefined;
        this._search = '';
        this._level = '';
        this._from = '';
        this._to = '';
        this._limit = 1000;
        this._currentPage = 0;
        this._followMode = false;
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
    const query = this._search.trim().toLowerCase();
    const level = this._level;
    const fromMillis = this._toMillis(this._from);
    const toMillisValue = this._toMillis(this._to);

    return entries.filter((entry) => {
      if (query && !entry.searchableText.includes(query)) {
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
          ? html`<tr>
              <td colspan="4" class="empty">
                Showing first ${shown.length} of ${rows.length} matched rows.
                Increase Max rows or enable pagination.
              </td>
            </tr>`
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

    return html`
      <section class="file-bar">
        <span class="file-name"
          >${this._data.fileName || 'No file loaded'}</span
        >
        <button type="button" @click=${this._openFile}>Open File…</button>
        <button type="button" @click=${() => this._exportFiltered('ndjson')} ?disabled=${this._filtered.length === 0}>Export NDJSON</button>
        <button type="button" @click=${() => this._exportFiltered('json')} ?disabled=${this._filtered.length === 0}>Export JSON</button>
      </section>

      <section class="toolbar">
        <label
          >Search
          <input
            type="text"
            .value=${this._search}
            @input=${(e: Event) => {
              this._search = (e.target as HTMLInputElement).value;
            }}
            placeholder="message / key / value"
          />
        </label>

        <label
          >Level
          <select
            .value=${this._level}
            @change=${(e: Event) => {
              this._level = (e.target as HTMLSelectElement).value;
            }}
          >
            <option value="">All</option>
            <option value="trace">trace</option>
            <option value="debug">debug</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
            <option value="fatal">fatal</option>
            <option value="unknown">unknown</option>
          </select>
        </label>

        <label
          >From
          <input
            type="datetime-local"
            .value=${this._from}
            @change=${(e: Event) => {
              this._from = (e.target as HTMLInputElement).value;
            }}
          />
        </label>

        <label
          >To
          <input
            type="datetime-local"
            .value=${this._to}
            @change=${(e: Event) => {
              this._to = (e.target as HTMLInputElement).value;
            }}
          />
        </label>

        <label
          >Max rows
          <input
            type="number"
            min="50"
            max="10000"
            step="50"
            .value=${String(this._limit)}
            @change=${(e: Event) => {
              this._limit = this._normalizeLimit(
                (e.target as HTMLInputElement).value,
              );
            }}
          />
        </label>

        <label>
          <button type="button" @click=${this._confirm}>Apply Filter</button>
          <button type="button" @click=${this._reset}>Reset</button>
        </label>

        <label class="toggle-label">
          <input
            type="checkbox"
            .checked=${this._showInvalidLines}
            @change=${(e: Event) => {
              this._showInvalidLines = (e.target as HTMLInputElement).checked;
            }}
          />
          Show invalid lines (${this._data.invalidLines.length})
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
          Enable pagination
        </label>

        <label class="toggle-label follow-toggle">
          <input
            type="checkbox"
            .checked=${this._followMode}
            @change=${this._toggleFollow}
          />
          Follow (live tail)
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
              >Save current filter</button>
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
      </section>

      <section class="meta">
        ${this._data.fileName} | parsed entries: ${this._data.entries.length} |
        matched: ${this._filtered.length} | invalid lines:
        ${this._data.invalidLines.length}${invalidSummary}
      </section>

      <section class="layout">
        <div class="panel">
          <div class="table-wrapper">
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
                ${this._renderRows(shown)} ${truncationRow}
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
