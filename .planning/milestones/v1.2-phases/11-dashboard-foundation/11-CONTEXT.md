# Phase 11: Dashboard Foundation - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Standalone React + TypeScript + Tailwind dashboard that authenticates via Clerk, connects to the proxy API, and provides the navigation shell for all governance features. This phase delivers the app shell only — cost views, policy management, approvals, and alerts are built in subsequent phases on top of this foundation.

</domain>

<decisions>
## Implementation Decisions

### Navigation & layout
- Icon + label sidebar, always visible, collapsible to icon-only on smaller screens
- Flat nav list (not grouped) — items: Overview, Costs, Policies, Approvals, Alerts, Settings
- User avatar + name at sidebar bottom with dropdown for sign out, theme toggle, settings
- Main content area has page title + breadcrumb header for drill-down navigation
- Responsive: sidebar collapses on tablet, full sidebar on desktop

### Visual identity & theming
- Developer-tool minimal aesthetic — clean, dense, monochrome with accent color (Linear/Vercel/Railway style)
- Dark mode as default theme, light mode available via toggle
- Green/teal accent color — stands out from typical blue dev tools, fresh feel
- Theme preference persists across sessions (localStorage or user record)
- shadcn/ui component library (Radix-based, Tailwind-styled) — no dependency lock-in, excellent dark mode support

### Auth & onboarding flow
- Full-page auth screen with centered form — unauthenticated users see nothing else
- Clerk authentication with three sign-in methods: email/password, GitHub OAuth, Google OAuth
- No setup wizard — first sign-in drops users directly into the dashboard
- Empty states on each page guide new users (e.g., "No agents connected yet — configure your proxy")
- Proxy API URL configured in a Settings page (stored per-user), not hardcoded via env var

### Proxy connection status
- Status indicator in sidebar footer — small colored dot + text, always visible
- Three states: Connected (green dot), Disconnected (red dot), Reconnecting (yellow/pulsing dot)
- When disconnected: show stale data with prominent banner "Proxy disconnected — data may be stale", pages remain navigable, auto-reconnects
- Clicking status dot opens popover with: proxy URL, latency, last successful ping, and a "Reconnect" button

### Claude's Discretion
- Exact spacing, typography scale, and component sizing
- Router choice (React Router, TanStack Router, etc.)
- State management approach
- Reconnection interval and retry strategy
- Loading skeleton designs
- Exact responsive breakpoints

</decisions>

<specifics>
## Specific Ideas

- Sidebar aesthetic should feel like Linear or Vercel — professional dev tooling, not consumer SaaS
- Green/teal accent inspired by Railway/Supabase energy — fresh and distinguishable
- Connection status popover is a quick diagnostic tool — user shouldn't need to leave their current page to troubleshoot connectivity
- Empty states should be helpful, not just "nothing here" — point users to the next action

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 11-dashboard-foundation*
*Context gathered: 2026-02-26*
