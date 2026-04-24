# UI Design Specification — RepoRelay

Dark, tool-grade admin dashboard for RepoRelay.
Blends three design systems into one cohesive interface.

| System     | What it provides                                                 |
| ---------- | ---------------------------------------------------------------- |
| **Linear** | Layout shell, left sidebar nav, surfaces, tables, cards, tokens  |
| **Raycast**| Cmd+K command palette overlay, search UX, floating panel shadows |
| **Composio**| Electric cyan/cobalt glow on active indexing and query states    |

**Dark-only.** No light mode toggle. The warm-light "RepoRelay" theme is fully replaced.

---

## 1. Design Tokens

All tokens live as CSS custom properties on `:root` in `styles.css`.
Material M3 tokens (`--mat-sys-*`) are mapped from `--cw-*` on `html`.

### 1.1 Backgrounds

| Token              | Value       | Usage                          |
| ------------------ | ----------- | ------------------------------ |
| `--cw-bg-void`     | `#08090a`   | Page body, deepest background  |
| `--cw-bg-panel`    | `#0f1011`   | Sidebar panel                  |
| `--cw-bg-surface`  | `#191a1b`   | Cards, elevated surfaces       |
| `--cw-bg-hover`    | `#28282c`   | Hover states                   |
| `--cw-bg-input`    | `#141516`   | Form field backgrounds         |

### 1.2 Text

| Token                | Value       | Usage                        |
| -------------------- | ----------- | ---------------------------- |
| `--cw-text-primary`  | `#f7f8f8`   | Headings, primary labels     |
| `--cw-text-secondary`| `#d0d6e0`   | Body text, descriptions      |
| `--cw-text-muted`    | `#8a8f98`   | Tertiary, timestamps         |
| `--cw-text-dim`      | `#62666d`   | Disabled, quaternary         |

### 1.3 Accents

| Token                | Value                     | Usage                              |
| -------------------- | ------------------------- | ---------------------------------- |
| `--cw-accent`        | `#5e6ad2`                 | CTA backgrounds, brand indigo      |
| `--cw-accent-bright` | `#7170ff`                 | Interactive focus, links            |
| `--cw-accent-hover`  | `#828fff`                 | Hover on accent elements           |
| `--cw-accent-dim`    | `rgba(94,106,210,0.10)`   | Active nav background              |

### 1.4 Borders

| Token                | Value                      | Usage                     |
| -------------------- | -------------------------- | ------------------------- |
| `--cw-border`        | `rgba(255,255,255,0.08)`   | Standard border           |
| `--cw-border-subtle` | `rgba(255,255,255,0.05)`   | Subtle dividers           |

### 1.5 Status & Glow

| Token             | Value                      | Usage                             |
| ----------------- | -------------------------- | --------------------------------- |
| `--cw-green`      | `#27a644`                  | Ready/success                     |
| `--cw-red`        | `#FF6363`                  | Errors                            |
| `--cw-amber`      | `#e6a817`                  | Warnings, in-progress             |
| `--cw-cyan`       | `#00ffff`                  | Composio electric cyan (indexing)  |
| `--cw-cyan-glow`  | `rgba(0,255,255,0.12)`     | Cyan at 12% for glow backgrounds  |
| `--cw-cobalt`     | `#0007cd`                  | Active query states                |

### 1.6 Shadows & Radii

| Token             | Value                                                          |
| ----------------- | -------------------------------------------------------------- |
| `--cw-shadow`     | `0 1px 3px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.3)`      |
| `--cw-shadow-lg`  | `0 8px 24px rgba(0,0,0,0.5), 0 16px 48px rgba(0,0,0,0.3)`    |
| `--cw-glow`       | `0 0 20px rgba(94,106,210,0.15)`                               |
| `--cw-radius`     | `8px`                                                          |
| `--cw-radius-sm`  | `6px`                                                          |
| `--cw-radius-lg`  | `12px`                                                         |

### 1.7 Typography

| Token             | Value                                                          |
| ----------------- | -------------------------------------------------------------- |
| `--cw-font-sans`  | `'Inter', system-ui, -apple-system, sans-serif`                |
| `--cw-font-mono`  | `'JetBrains Mono', 'Fira Code', monospace`                     |

Font loading: Google Fonts Inter with `font-feature-settings: 'cv01', 'ss03'`
(alternate digits and open-aperture glyphs).

Body `font-size: 14px`, `line-height: 1.5`. Headings use `font-weight: 500`
(not 700 — Linear uses medium-weight headings). `letter-spacing: -0.01em` on
headings. `-webkit-font-smoothing: antialiased`.

---

## 2. Material M3 Token Mapping

Angular Material is **kept** and restyled through `--mat-sys-*` token overrides.
The `custom-theme.scss` switches to `theme-type: dark` and `color-scheme: dark`.

```scss
// custom-theme.scss
@use '@angular/material' as mat;

html {
  color-scheme: dark;

  @include mat.theme((
    color: (
      primary: mat.$violet-palette,
      theme-type: dark,
    ),
    typography: Inter,
    density: 0,
  ));
}
```

The `--mat-sys-*` overrides on `html` in `styles.css`:

```
--mat-sys-surface:                    var(--cw-bg-void)
--mat-sys-surface-dim:                var(--cw-bg-void)
--mat-sys-surface-bright:             var(--cw-bg-surface)
--mat-sys-surface-container-lowest:   var(--cw-bg-void)
--mat-sys-surface-container-low:      var(--cw-bg-panel)
--mat-sys-surface-container:          var(--cw-bg-surface)
--mat-sys-surface-container-high:     var(--cw-bg-surface)
--mat-sys-surface-container-highest:  var(--cw-bg-hover)
--mat-sys-on-surface:                 var(--cw-text-primary)
--mat-sys-on-surface-variant:         var(--cw-text-secondary)
--mat-sys-background:                 var(--cw-bg-void)
--mat-sys-on-background:              var(--cw-text-primary)
--mat-sys-primary:                    var(--cw-accent)
--mat-sys-on-primary:                 #fff
--mat-sys-primary-container:          rgba(94,106,210,0.15)
--mat-sys-on-primary-container:       var(--cw-accent-bright)
--mat-sys-secondary:                  var(--cw-text-muted)
--mat-sys-on-secondary:               var(--cw-bg-void)
--mat-sys-tertiary:                   var(--cw-cyan)
--mat-sys-on-tertiary:                var(--cw-bg-void)
--mat-sys-error:                      var(--cw-red)
--mat-sys-on-error:                   #fff
--mat-sys-outline:                    var(--cw-border)
--mat-sys-outline-variant:            var(--cw-border-subtle)
--mat-sys-inverse-surface:            var(--cw-text-primary)
--mat-sys-inverse-on-surface:         var(--cw-bg-void)
--mat-sys-inverse-primary:            var(--cw-accent-bright)
--mat-sys-scrim:                      rgba(0,0,0,0.6)
--mat-sys-shadow:                     rgba(0,0,0,0.5)
--mat-sys-surface-tint:               var(--cw-accent)
--mat-sys-surface-variant:            var(--cw-bg-surface)
```

---

## 3. Layout — App Shell

Replace the top `<mat-toolbar>` with a **collapsible left sidebar** (Linear-style).

```
+-----+------------------------------------------+
| S   |                                          |
| I   |          <main> content area             |
| D   |          max-width: 960px                |
| E   |          centered in remaining space     |
| B   |                                          |
| A   |                                          |
| R   |                                          |
+-----+------------------------------------------+
```

### 3.1 Sidebar Structure

```html
<div class="shell" [class.sidebar-collapsed]="sidebarCollapsed()">
  <aside class="sidebar">
    <div class="sidebar-header">
      <a routerLink="/" class="brand">
        <mat-icon class="brand-icon">hub</mat-icon>
        <span class="brand-text">RepoRelay</span>
      </a>
      <button class="sidebar-toggle" (click)="toggleSidebar()">
        <mat-icon>{{ sidebarCollapsed() ? 'chevron_right' : 'chevron_left' }}</mat-icon>
      </button>
    </div>

    <nav class="sidebar-nav">
      <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{exact: true}">
        <mat-icon>folder</mat-icon>
        <span class="nav-label">Repositories</span>
      </a>
      <a routerLink="/search" routerLinkActive="active">
        <mat-icon>search</mat-icon>
        <span class="nav-label">Search</span>
      </a>
    </nav>

    <div class="sidebar-search-trigger" (click)="openCommandPalette()">
      <mat-icon>search</mat-icon>
      <span class="nav-label">Search...</span>
      <kbd class="nav-label">{{ isMac ? '⌘' : 'Ctrl' }}K</kbd>
    </div>

    <div class="sidebar-repos">
      <div class="sidebar-section-label nav-label">Repos</div>
      @for (repo of repos(); track repo.name) {
        <a [routerLink]="'/' + repo.name" class="sidebar-repo-item" routerLinkActive="active">
          <span class="repo-dot" [class.indexing]="isIndexing(repo)"></span>
          <span class="nav-label">{{ repo.name }}</span>
        </a>
      }
    </div>
  </aside>

  <main>
    <router-outlet />
  </main>
</div>
```

### 3.2 Sidebar Styling

- **Width expanded:** `220px`. **Collapsed:** `52px` (icon-only).
- **Background:** `--cw-bg-panel` (`#0f1011`).
- **Right border:** `1px solid var(--cw-border)`.
- **Nav items:** 32px height, 8px horizontal padding, `--cw-radius-sm` border-radius.
- **Active nav:** `background: var(--cw-accent-dim)`, `color: var(--cw-text-primary)`.
- **Hover nav:** `background: var(--cw-bg-hover)`.
- **Collapsed state:** `.nav-label` elements get `display: none`. Only icons show.
- **Transition:** `width 200ms ease` on the sidebar, content area adjusts via `margin-left`.
- **Repo dot indicators:** 6px circle, `--cw-text-dim` by default, `--cw-cyan` when indexing.

### 3.3 Main Content Area

- No max-width constraint from the shell. Each page sets its own max-width.
- `padding: 2rem 2.5rem`.
- `margin-left` matches sidebar width (animated).

---

## 4. Typography Scale

| Element     | Size   | Weight | Color                | Letter-spacing |
| ----------- | ------ | ------ | -------------------- | -------------- |
| Page h2     | 1.4rem | 500    | `--cw-text-primary`  | -0.02em        |
| Section h3  | 1.05rem| 500    | `--cw-text-primary`  | -0.01em        |
| Body text   | 14px   | 400    | `--cw-text-secondary`| 0              |
| Small/muted | 12px   | 400    | `--cw-text-muted`    | 0.01em         |
| Code inline | 13px   | 400    | `--cw-text-primary`  | 0              |
| Table header| 11px   | 600    | `--cw-text-muted`    | 0.04em         |

All text uses `--cw-font-sans` unless it is code, which uses `--cw-font-mono`.

---

## 5. Component Restyling

### 5.1 Cards (`.mat-mdc-card`)

- `background: var(--cw-bg-surface)`. `border: 1px solid var(--cw-border)`.
- `border-radius: var(--cw-radius)`. `box-shadow: var(--cw-shadow)`.
- Hover: `border-color: var(--cw-border)` brightens to `rgba(255,255,255,0.12)`.

### 5.2 Tables (`.mat-mdc-table`)

- Background: `var(--cw-bg-surface)`. Border: `1px solid var(--cw-border)`.
- Header row: `background: var(--cw-bg-panel)`. Text: `--cw-text-muted`, uppercase 11px.
- Row hover: `var(--cw-bg-hover)`. Row border: `var(--cw-border-subtle)`.

### 5.3 Form Fields

- Fill background: `var(--cw-bg-input)`.
- Border: `1px solid var(--cw-border)`. Focus: `var(--cw-accent-bright)`.
- Label: `--cw-text-muted`. Input text: `--cw-text-primary`.

### 5.4 Buttons

- Flat/unelevated (CTA): `background: var(--cw-accent)`, `color: #fff`. Hover: `var(--cw-accent-hover)` bg.
- Outlined: transparent bg, `border: 1px solid var(--cw-border)`, text `--cw-text-secondary`.
  Hover: `background: var(--cw-bg-hover)`.
- Icon buttons: `color: var(--cw-text-muted)`. Hover: `var(--cw-text-primary)`.

### 5.5 Chips (`.mat-mdc-chip`)

- Background: `var(--cw-bg-hover)`. Text: `--cw-text-secondary`. Border: none.
- Colored variants (stage chips): use translucent status colors:
  - Ready/done: `rgba(39,166,68,0.12)` bg, `--cw-green` text.
  - Error: `rgba(255,99,99,0.12)` bg, `--cw-red` text.
  - Active/indexing: `var(--cw-cyan-glow)` bg, `--cw-cyan` text.
  - Pending: `var(--cw-bg-hover)` bg, `--cw-text-muted` text.

### 5.6 Select & Autocomplete Panels

- Panel background: `var(--cw-bg-surface)`.
- Border: `1px solid var(--cw-border)`. Radius: `--cw-radius-sm`.
- Option hover: `var(--cw-bg-hover)`. Selected: `var(--cw-accent-dim)` bg, `--cw-accent-bright` text.

### 5.7 Progress Bar

- Track: `var(--cw-bg-hover)`.
- Active bar: `var(--cw-accent)`.
- When indexing (Composio glow active): bar gradient `var(--cw-cyan)` to `var(--cw-accent-bright)`,
  with `box-shadow: 0 0 12px var(--cw-cyan-glow)`.

### 5.8 Scrollbars

- Track: transparent. Thumb: `rgba(255,255,255,0.1)`. Thumb hover: `rgba(255,255,255,0.18)`.

### 5.9 Selection

- `::selection`: `background: rgba(94,106,210,0.35)`, `color: #fff`.

---

## 6. Custom Highlight.js Theme

Create `ui/src/code-theme.css` to replace `github-dark.min.css` in `angular.json`.

Palette derived from Linear's dark surfaces:

| hljs class         | Color     | Maps to                           |
| ------------------ | --------- | --------------------------------- |
| `.hljs`            | `#d0d6e0` | `--cw-text-secondary` on `--cw-bg-surface` |
| `.hljs-keyword`    | `#7170ff` | `--cw-accent-bright` (violet)     |
| `.hljs-string`     | `#27a644` | `--cw-green`                      |
| `.hljs-number`     | `#e6a817` | `--cw-amber`                      |
| `.hljs-comment`    | `#62666d` | `--cw-text-dim` (italic)          |
| `.hljs-function`   | `#828fff` | `--cw-accent-hover`               |
| `.hljs-title`      | `#d0d6e0` | `--cw-text-secondary`             |
| `.hljs-type`       | `#00c8c8` | Teal (muted cyan)                 |
| `.hljs-built_in`   | `#00c8c8` | Same teal                         |
| `.hljs-params`     | `#d0d6e0` | `--cw-text-secondary`             |
| `.hljs-literal`    | `#FF6363` | `--cw-red`                        |
| `.hljs-attr`       | `#828fff` | `--cw-accent-hover`               |
| `.hljs-selector-*` | `#7170ff` | `--cw-accent-bright`              |
| `.hljs-meta`       | `#8a8f98` | `--cw-text-muted`                 |

Background: `var(--cw-bg-surface)` / `#191a1b`. Padding: `1rem`. `border-radius: var(--cw-radius-sm)`.

---

## 7. Command Palette (Phase 3)

Raycast-inspired floating command palette, built with Angular CDK Overlay.

### 7.1 Trigger

- Global `@HostListener('document:keydown', ['$event'])` in `App` component.
- `Cmd+K` (Mac) / `Ctrl+K` (Windows/Linux) toggles the overlay.
- Sidebar "Search..." button also opens it.

### 7.2 Component Structure

```
ui/src/app/command-palette/
  command-palette.component.ts
  command-palette.component.html
  command-palette.component.css
```

Standalone component using CDK `Overlay`, `OverlayRef`, `CdkTrapFocus`.

### 7.3 Visual Design

- **Scrim:** `rgba(0,0,0,0.6)` backdrop. Click-outside closes.
- **Panel:** `max-width: 640px`, centered horizontally, `top: 20vh`.
- **Background:** `var(--cw-bg-surface)`.
- **Border:** `1px solid var(--cw-border)`.
- **Shadow:** `var(--cw-shadow-lg)`.
- **Border-radius:** `var(--cw-radius-lg)`.

### 7.4 Layout

```
+------------------------------------------+
| 🔍  Search repos, code, actions...      |
+------------------------------------------+
| Repos                                    |
|   📁 my-repo                             |
|   📁 another-repo                        |
| Actions                                  |
|   ⚡ Search code                          |
|   ⚡ Browse files                         |
+------------------------------------------+
```

- **Input:** Full-width, no border, large (16px) text, `--cw-text-primary`.
  Placeholder: `--cw-text-dim`. Auto-focused on open.
- **Results list:** Grouped by category. Group headers: 11px uppercase `--cw-text-dim`.
- **Result items:** 36px height. Icon + label. Arrow keys navigate, Enter selects.
- **Selected item:** `background: var(--cw-bg-hover)`, left border accent.
- **Dividers:** `1px solid var(--cw-border-subtle)` between input and results.

### 7.5 Actions

| Action                  | Behavior                                |
| ----------------------- | --------------------------------------- |
| Go to repo `{name}`     | `router.navigate(['/', name])`          |
| Search code             | `router.navigate(['/search'])`          |
| Browse files `{name}`   | Navigate to file browser for that repo  |
| View symbols `{name}`   | Navigate to symbol explorer for that repo|

### 7.6 Keyboard

- `↑` / `↓` — navigate items
- `Enter` — select item
- `Escape` — close palette
- Type to filter — debounce 100ms

---

## 8. Composio Glow States (Phase 4)

Cyan glow is applied **only** to elements representing active indexing or loading states.
It is not a general accent — it signals real-time activity.

### 8.1 Active Indexing Rows

On repo list and repo detail pages, when a repo's stage is actively indexing
(`cloning`, `parsing`, `chunking`, `embedding`, `finalizing`):

- **Row border-left:** `3px solid var(--cw-cyan)`.
- **Row background:** `var(--cw-cyan-glow)` (subtle).
- **Stage chip:** `background: var(--cw-cyan-glow)`, `color: var(--cw-cyan)`.

### 8.2 Progress Bar Glow

When the progress bar is actively moving (not at 0% or 100%):

- Bar color: linear gradient `var(--cw-cyan)` -> `var(--cw-accent-bright)`.
- Bar shadow: `0 0 12px var(--cw-cyan-glow)`.
- Track background: `var(--cw-bg-hover)`.

### 8.3 Sidebar Repo Dots

- Default (ready): `--cw-green` dot.
- Indexing: `--cw-cyan` dot with `animation: pulse 2s ease-in-out infinite`.
- Error: `--cw-red` dot.
- Idle/pending: `--cw-text-dim` dot.

```css
@keyframes pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 4px var(--cw-cyan-glow); }
  50% { opacity: 0.5; box-shadow: 0 0 8px var(--cw-cyan-glow); }
}
```

### 8.4 Search Loading

When `httpResource` is in loading state (search results pending):

- Subtle `box-shadow: 0 0 16px var(--cw-cyan-glow)` on the results container.
- Spinner color: `var(--cw-cyan)`.

---

## 9. Page-by-Page Restyling Notes

### 9.1 Repo List (`repo-list.component`)

- **Add card:** Dark card with dashed `--cw-border` border, `+` icon in `--cw-text-dim`.
  Hover: border becomes `--cw-accent-bright`, icon brightens.
- **Repo table:** Follow table styling from section 5.2. Stage column uses
  colored chips from 5.5. Active indexing rows get Composio glow from 8.1.
- **Form fields** (add repo dialog): dark input styling from 5.3.

### 9.2 Repo Detail (`repo-detail.component`)

- **Metadata card:** Dark card (5.1). Labels in `--cw-text-muted`, values in `--cw-text-primary`.
- **Refs table:** Dark table (5.2). Stage chips. Active rows get cyan glow.
- **Progress card:** Dark surface. When indexing, the entire card gets a subtle
  `border: 1px solid var(--cw-cyan-glow)` and the progress bar gets glow treatment (8.2).
- **Action buttons** (browse, symbols): outlined buttons (5.4).

### 9.3 Search (`search.component`)

- **Search form:** Dark inputs (5.3). Submit button: accent flat (5.4).
- **Result cards:** Dark card (5.1). Code blocks use custom hljs theme.
- **Loading state:** Cyan glow on results container (8.4).

### 9.4 File Browser (`file-browser.component`)

- **Tree panel (left):** `background: var(--cw-bg-panel)`. File items: hover `--cw-bg-hover`.
  Selected file: `background: var(--cw-accent-dim)`, text `--cw-text-primary`.
  Directory icons: `--cw-text-dim`. File icons: `--cw-text-muted`.
- **Content panel (right):** Dark code block with custom hljs theme.
  Line numbers (if any): `--cw-text-dim` on `--cw-bg-panel` background.
- **Symbol chips** in file view: dark chips (5.5) with `--cw-accent-dim` background.

### 9.5 Symbol Explorer (`symbol-explorer.component`)

- **Search form:** Dark inputs (5.3).
- **Results list:** Dark surface cards. Symbol name in `--cw-text-primary` mono.
  Kind badge uses colored chip (5.5). File path in `--cw-text-muted`.
- **Detail panel:** Code signature in mono on dark code background.
  Documentation text in `--cw-text-secondary`.

### 9.6 Shared: RefPicker

- Uses `mat-select` — inherits dark select styling (5.6).
- Option groups: group label in `--cw-text-dim`. Options in `--cw-text-secondary`.

### 9.7 Shared: ProgressCard

- Dark card surface. Label: `--cw-text-muted`. Percentage: `--cw-text-primary`.
- When actively indexing: Composio glow treatment (8.2).
- Stage label text: `--cw-text-secondary`.

---

## 10. Implementation Phases

### Phase 0 — Foundation

**Goal:** Swap all tokens to dark, ensure the app renders dark everywhere.

| File | Changes |
|------|---------|
| `ui/src/styles.css` | Replace all `--cw-*` tokens with dark palette (section 1). Update `--mat-sys-*` mapping (section 2). Dark scrollbars, selection, global resets. Update font import to Inter with `cv01`/`ss03`. Body `font-size: 14px`, `line-height: 1.5`. |
| `ui/src/custom-theme.scss` | `theme-type: dark`, `color-scheme: dark`, `primary: mat.$violet-palette`. |
| `ui/src/code-theme.css` | **New file.** Custom hljs theme (section 6). |
| `ui/angular.json` | Replace `github-dark.min.css` with `src/code-theme.css` in styles array. |
| `ui/src/index.html` | Update `theme-color` meta to `#08090a`. |

**Verify:** `pnpm build` (in `ui/`), visual check that the app is fully dark.

### Phase 1 — App Shell (Sidebar)

**Goal:** Replace `<mat-toolbar>` with collapsible left sidebar.

| File | Changes |
|------|---------|
| `ui/src/app/app.ts` | Add `signal` for sidebar state, `httpResource` for repo list, `HostListener` for Cmd+K. Add `MatListModule` or just use plain anchors. |
| `ui/src/app/app.component.html` | Full rewrite: sidebar + main layout (section 3.1). |
| `ui/src/app/app.component.css` | Full rewrite: sidebar styling (section 3.2), main area (section 3.3). |

**Verify:** `pnpm build`, sidebar renders, navigation works, collapse toggle works.

### Phase 2 — Page Restyling

**Goal:** Each page uses dark tokens. No structural HTML changes unless necessary.

Changes are primarily CSS with minor HTML tweaks for class additions.

| File | Key changes |
|------|-------------|
| `repo-list.component.css` | Dark add-card, dark table rows, dark form fields. |
| `repo-detail.component.css` | Dark metadata, dark refs table, dark action buttons. |
| `search.component.css` | Dark form, dark result cards, dark code blocks. |
| `file-browser.component.css` | Dark tree panel, dark content panel. |
| `symbol-explorer.component.css` | Dark search, dark result cards, dark detail. |
| `ref-picker.component.css` | Dark select styling. |
| `progress-card.component.css` | Dark progress surface. |

**Verify:** `pnpm build`, all 6 pages render correctly with dark theme.

### Phase 3 — Command Palette

**Goal:** Functional Cmd+K palette with repo navigation and action shortcuts.

| File | Description |
|------|-------------|
| `command-palette.component.ts` | **New.** CDK Overlay, keyboard navigation, fuzzy filter. |
| `command-palette.component.html` | **New.** Input + grouped results list. |
| `command-palette.component.css` | **New.** Raycast-inspired floating panel (section 7.3). |
| `app.ts` | Wire up Cmd+K listener to open palette. Import `Overlay` from CDK. |

**Verify:** `pnpm build`. Cmd+K opens palette, typing filters, Enter navigates, Escape closes.

### Phase 4 — Composio Glow States

**Goal:** Active indexing/loading states get cyan glow treatment.

| File | Changes |
|------|---------|
| `repo-list.component.css` | Active indexing row glow (8.1). |
| `repo-list.component.html` | Add conditional class for indexing rows. |
| `repo-detail.component.css` | Active refs glow, progress bar glow (8.1, 8.2). |
| `repo-detail.component.html` | Add conditional class for indexing refs. |
| `progress-card.component.css` | Cyan gradient bar, glow shadow (8.2). |
| `progress-card.component.html` | Add conditional class when actively indexing. |
| `app.component.css` | Sidebar repo dot pulse animation (8.3). |
| `search.component.css` | Loading glow on results container (8.4). |

**Verify:** `pnpm build`. Visual check that glow appears only on active states.

### Phase 5 — E2E Test Updates

**Goal:** Regenerate all 33 screenshot baselines, add command palette test.

| Task | Description |
|------|-------------|
| Regenerate baselines | Run E2E tests with `--update-snapshots` flag. |
| New test | Add `command-palette.spec.ts` — open/close, keyboard nav, navigation. |
| Selector audit | Verify all E2E selectors still match after sidebar change (`.brand` etc). |

---

## 11. Files Inventory

### New files

| File | Phase |
|------|-------|
| `ui/src/code-theme.css` | 0 |
| `ui/src/app/command-palette/command-palette.component.ts` | 3 |
| `ui/src/app/command-palette/command-palette.component.html` | 3 |
| `ui/src/app/command-palette/command-palette.component.css` | 3 |
| `ui/e2e/command-palette.spec.ts` | 5 |

### Modified files

| File | Phases |
|------|--------|
| `ui/src/styles.css` | 0 |
| `ui/src/custom-theme.scss` | 0 |
| `ui/angular.json` | 0 |
| `ui/src/index.html` | 0 |
| `ui/src/app/app.ts` | 1, 3 |
| `ui/src/app/app.component.html` | 1 |
| `ui/src/app/app.component.css` | 1, 4 |
| `ui/src/app/repos/repo-list/repo-list.component.css` | 2, 4 |
| `ui/src/app/repos/repo-list/repo-list.component.html` | 4 |
| `ui/src/app/repos/repo-detail/repo-detail.component.css` | 2, 4 |
| `ui/src/app/repos/repo-detail/repo-detail.component.html` | 4 |
| `ui/src/app/search/search.component.css` | 2, 4 |
| `ui/src/app/file-browser/file-browser.component.css` | 2 |
| `ui/src/app/symbol-explorer/symbol-explorer.component.css` | 2 |
| `ui/src/app/shared/ref-picker/ref-picker.component.css` | 2 |
| `ui/src/app/shared/progress-card/progress-card.component.css` | 2, 4 |

### Unchanged files (no modifications needed)

- `ui/src/app/app.routes.ts` — routes unchanged
- `ui/src/app/types.ts` — type re-exports unchanged
- `ui/src/app/app.config.ts` — providers unchanged
- `ui/src/app/shared/highlight.pipe.ts` — hljs pipe unchanged
- `ui/src/app/shared/lang-from-path.ts` — extension mapper unchanged
- `ui/src/app/shared/stage-label.ts` — stage labels unchanged

---

## 12. E2E Selector Impact

Selectors that **still work** (Angular Material kept):
`mat-select`, `mat-chip`, `textarea[matInput]`, `button[mat-list-item]`, `mat-row`, `mat-header-row`

Selectors that **need review** after sidebar:
- `.brand` — moves from toolbar to sidebar (same class, new location)
- `.back-link` — unchanged (page-level, not shell)

Custom CSS classes unchanged: `.error`, `.source-tab`, `.ref-badge`, `.tree-file`,
`.file-path-display`, `.strategy-badge`, `.chunk-summary-item`, `.breadcrumb`, `.sig`, `.sym-doc`

---

## 13. Verification Checklist

After each phase:

```bash
cd ui && pnpm build           # TypeScript + Angular compilation
cd .. && pnpm test:unit       # Unit tests (should not break)
pnpm format:check             # Prettier formatting
```

After Phase 5 (E2E):

```bash
pnpm test                     # Full test suite including integration
```
