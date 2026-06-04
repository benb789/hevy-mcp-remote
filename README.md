# Hevy MCP Remote

Remote [Model Context Protocol](https://modelcontextprotocol.io) server for the [Hevy](https://hevy.com) API. Deploy to Railway and connect from Claude (web or mobile) without keeping your PC on.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HEVY_API_KEY` | Yes | From [hevy.com/settings?developer](https://hevy.com/settings?developer) (Hevy Pro) |
| `CLAUDE_AUTH_TOKEN` | Yes | Secret you choose; Claude sends this as `Authorization: Bearer ...` |
| `PORT` | No | Defaults to `3000` (Railway sets this automatically) |

## Tools

| Tool | Description |
|------|-------------|
| `get_workouts` | Paginated workout list (`page`, `pageSize`) |
| `get_workout` | Single workout by ID |
| `get_routines` | Paginated routines |
| `get_exercise_templates` | Exercise catalog (cached; use `refresh: true` to refetch) |
| `get_workout_events` | Updates/deletes since `since` (ISO 8601) |

## Local development

```bash
cp .env.example .env
# Edit .env with your keys
npm install
npm run build
npm start
```

Health check: `GET /health`  
MCP endpoint: `POST /mcp` with `Authorization: Bearer <CLAUDE_AUTH_TOKEN>`

## Deploy to Railway

1. Push this repo to a **private** GitHub repository.
2. [railway.app](https://railway.app) → **New Project** → **GitHub Repository** → select the repo.
3. **Variables**: add `HEVY_API_KEY` and `CLAUDE_AUTH_TOKEN`.
4. **Settings → Networking** → **Generate Domain**.
5. Your MCP URL is `https://<your-domain>/mcp`.

## Connect Claude (phone or web)

1. **Settings → Connectors → Add Custom Connector**
2. **Name:** `Hevy`
3. **Remote MCP Server URL:** `https://<your-railway-domain>/mcp`
4. **Advanced → Authorization:** `Bearer <your CLAUDE_AUTH_TOKEN>`
5. Save

Example prompts: *"What was my last workout?"*, *"Show bench press progression this month."*
