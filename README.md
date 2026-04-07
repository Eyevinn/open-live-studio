# open-live-studio

Browser-based production controller for the Open Live broadcast platform. Built with React 19, TypeScript, Vite, and TailwindCSS v4.

## Requirements

- Node.js 23+
- pnpm 10.33+
- [open-live](https://github.com/Eyevinn/open-live) backend running

## Setup

```bash
pnpm install
cp .env.example .env
# Edit .env if your backend runs on a different URL
```

## Environment variables

Copy `.env.example` to `.env`:

| Variable | Description | Default |
|---|---|---|
| `VITE_API_URL` | URL of the open-live backend API | `http://localhost:3000` |

> **Never commit `.env`** — it is gitignored. Use `.env.example` as the reference.

## Commands

```bash
# Start development server (hot reload, connects to backend)
pnpm dev

# Type-check without building
pnpm typecheck

# Type-check and build for production
pnpm build

# Serve the production build (used by OSC — respects $PORT)
pnpm start

# Preview the production build locally
pnpm preview

# Lint
pnpm lint
```

## Development

The app expects the [open-live](https://github.com/Eyevinn/open-live) backend to be running. Start that first, then run `pnpm dev` here. The dev server runs on `http://localhost:5173` by default.

Sources and productions are polled from the backend every 5 seconds. All changes (add, remove, activate) are persisted immediately via the REST API.
