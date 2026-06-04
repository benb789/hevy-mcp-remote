import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { HevyClient } from "./hevy.js";

const PORT = Number(process.env.PORT ?? 3000);
const HEVY_API_KEY = process.env.HEVY_API_KEY?.trim();
const CLAUDE_AUTH_TOKEN = process.env.CLAUDE_AUTH_TOKEN?.trim();

function getConfigErrors(): string[] {
  const errors: string[] = [];
  if (!HEVY_API_KEY) errors.push("HEVY_API_KEY");
  if (!CLAUDE_AUTH_TOKEN) errors.push("CLAUDE_AUTH_TOKEN");
  return errors;
}

function getHevy(): HevyClient {
  if (!HEVY_API_KEY) {
    throw new Error("HEVY_API_KEY is not configured");
  }
  return new HevyClient(HEVY_API_KEY);
}

let exerciseTemplatesCache: unknown | null = null;

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function createMcpServer(hevy: HevyClient): McpServer {
  const server = new McpServer(
    {
      name: "hevy-mcp-remote",
      version: "1.0.0",
    },
    {
      instructions:
        "This server exposes the user's Hevy workout data. Use get_workouts for recent sessions, get_workout for full details by ID, get_routines for saved routines, get_exercise_templates for exercise names/metadata, and get_workout_events for changes since a date. Workout lists are paginated (max pageSize 10).",
    }
  );

  server.tool(
    "get_workouts",
    "Fetch a paginated list of workouts (newest first)",
    {
      page: z.number().int().min(1).optional().describe("Page number (1-based)"),
      pageSize: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Items per page (max 10)"),
    },
    async ({ page = 1, pageSize = 10 }) => jsonResult(await hevy.getWorkouts(page, pageSize))
  );

  server.tool(
    "get_workout",
    "Fetch a single workout by ID with full exercise and set details",
    { workoutId: z.string().describe("Hevy workout ID") },
    async ({ workoutId }) => jsonResult(await hevy.getWorkout(workoutId))
  );

  server.tool(
    "get_routines",
    "Fetch a paginated list of saved routines",
    {
      page: z.number().int().min(1).optional().describe("Page number (1-based)"),
      pageSize: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Items per page (max 10)"),
    },
    async ({ page = 1, pageSize = 10 }) => jsonResult(await hevy.getRoutines(page, pageSize))
  );

  server.tool(
    "get_exercise_templates",
    "Fetch exercise templates (cached in memory after first call)",
    {
      refresh: z
        .boolean()
        .optional()
        .describe("Set true to bypass cache and refetch from Hevy"),
    },
    async ({ refresh = false }) => {
      if (!exerciseTemplatesCache || refresh) {
        exerciseTemplatesCache = await hevy.getExerciseTemplates(1, 100);
      }
      return jsonResult(exerciseTemplatesCache);
    }
  );

  server.tool(
    "get_workout_events",
    "Fetch workout update/delete events since a date (for sync)",
    {
      page: z.number().int().min(1).optional().describe("Page number (1-based)"),
      pageSize: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Items per page (max 10)"),
      since: z
        .string()
        .optional()
        .describe("ISO 8601 timestamp, e.g. 2025-01-01T00:00:00Z"),
    },
    async ({ page = 1, pageSize = 10, since = "1970-01-01T00:00:00Z" }) =>
      jsonResult(await hevy.getWorkoutEvents(page, pageSize, since))
  );

  return server;
}

function requireConfigured(req: Request, res: Response, next: NextFunction): void {
  const missing = getConfigErrors();
  if (missing.length > 0) {
    res.status(503).json({
      error: "Server not configured",
      missing,
      hint: "Add HEVY_API_KEY and CLAUDE_AUTH_TOKEN in Railway Variables, then redeploy.",
    });
    return;
  }
  next();
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const expected = `Bearer ${CLAUDE_AUTH_TOKEN}`;

  if (!header || header !== expected) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null,
    });
    return;
  }

  next();
}

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  const missing = getConfigErrors();
  res.json({
    status: missing.length === 0 ? "ok" : "misconfigured",
    port: PORT,
    missing,
  });
});

const transports: Record<string, StreamableHTTPServerTransport> = {};

const mcpPostHandler = async (req: Request, res: Response) => {
  try {
    const hevy = getHevy();
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (id) => {
          transports[id] = transport;
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          delete transports[sid];
        }
      };

      const server = createMcpServer(hevy);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    } else if (sessionId) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Session not found" },
        id: null,
      });
      return;
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: Session ID required" },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
};

app.post("/mcp", requireConfigured, requireAuth, mcpPostHandler);

app.get("/mcp", requireConfigured, requireAuth, (_req, res) => {
  res.status(405).set("Allow", "POST").send("Method Not Allowed");
});

app.listen(PORT, "0.0.0.0", () => {
  const missing = getConfigErrors();
  console.log(`Hevy MCP server listening on 0.0.0.0:${PORT} (PORT env=${process.env.PORT ?? "unset"})`);
  if (missing.length > 0) {
    console.warn(`Missing environment variables: ${missing.join(", ")}`);
  } else {
    console.log("Configuration OK");
  }
});

process.on("SIGINT", () => process.exit(0));
