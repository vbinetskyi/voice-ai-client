# voice-ai-client — frontend

React operator UI for the voice-ai backend. Lets you start an AI-powered outbound phone call, answer questions the AI surfaces mid-call, and end the call manually.

## Prerequisites

- [Node.js](https://nodejs.org) ≥ 18 or [Bun](https://bun.sh) ≥ 1.0
- The [voice-ai backend](../voice-ai) running locally on port `3000`

## Setup

```sh
# Install dependencies
bun install   # or: npm install

# Copy the example env file
cp .env.example .env
```

Edit `.env`:

| Variable | Description |
|---|---|
| `VITE_API_BASE` | Backend HTTP base URL, e.g. `http://localhost:3000` |
| `VITE_WS_BASE` | Backend WebSocket base URL, e.g. `ws://localhost:3000` |

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

Enter a **goal** describing what the AI should accomplish (e.g. "Order a large pepperoni pizza for delivery"), then choose a transport:

**Browser** (no phone required):
1. Select **Browser** and click **Start**.
2. Click the microphone button to open your mic — the AI speaks directly through your browser.
3. When the AI needs information from you, a question appears in the chat. Type your answer and press **Send**.
4. Click **End** to finish.

**Twilio** (outbound phone call):
1. Select **Twilio**, enter the phone number in E.164 format (e.g. `+15551234567`), and click **Start**.
2. The AI dials the number and begins the conversation.
3. When the AI needs information from you, a question appears in the chat. Type your answer and press **Send**.
4. Click **End** at any time to hang up manually.

## SDK regeneration

The API client under `src/api/` is auto-generated from the backend's OpenAPI spec. After changing backend routes, regenerate it from the backend directory:

```sh
cd ../voice-ai
bun run generate:client
```
