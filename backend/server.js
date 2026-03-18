import "dotenv/config";
import express from "express";
import cors from "cors";
import { sessionsRouter } from "./routes/sessions.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.use("/api/sessions", sessionsRouter);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`[Ash] Backend running on http://localhost:${PORT}`);
});
