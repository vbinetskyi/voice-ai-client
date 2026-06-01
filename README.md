# voice-ai-client — frontend

React operator UI for the voice-ai backend. Lets you start an AI-powered outbound phone call, answer questions the AI surfaces mid-call, and end the call manually.

## Prerequisites

- [Node.js](https://nodejs.org) ≥ 18 or [Bun](https://bun.sh) ≥ 1.0
- The [voice-ai backend](../voice-ai) running locally on port `3000`

## Setup

```sh
# Install dependencies
bun install   # or: npm install
```

The backend URL is hardcoded in `src/App.tsx`:

```ts
client.setConfig({ baseUrl: "http://localhost:3000" });
```

Change this if the backend runs on a different host or port.

## Running

```sh
bun run dev   # or: npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Commands

```sh
bun run dev      # start Vite dev server with hot reload
bun run build    # production build → dist/
bun run preview  # preview the production build locally
bun run lint     # run Biome linter
bun run lint:fix # auto-fix lint issues
```

## Usage

1. Enter a **goal** describing what the AI should accomplish (e.g. "Order a large pepperoni pizza for delivery").
2. Enter the **phone number** to call in E.164 format (e.g. `+15551234567`).
3. Click **Start call** — the AI dials the number and begins the conversation.
4. When the AI needs information from you, a question appears in the chat. Type your answer and press **Send**.
5. The AI relays your answer to the business and continues.
6. Click **End call** at any time to hang up manually.

## SDK regeneration

The API client under `src/api/` is auto-generated from the backend's OpenAPI spec. After changing backend routes, regenerate it from the backend directory:

```sh
cd ../voice-ai
bun run generate:client
```
