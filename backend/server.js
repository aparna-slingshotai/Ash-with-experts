import "dotenv/config";
import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { sessionsRouter } from "./routes/sessions.js";
import { debriefRouter } from "./routes/debrief.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Serve the web app
app.use(express.static(join(__dirname, "public")));

app.use("/api/sessions", sessionsRouter);
app.use("/api/debrief", debriefRouter);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Export for Vercel serverless
export default app;

// Local dev: start listening
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`[Ash] Backend running on http://localhost:${PORT}`);
  });
}
