import "dotenv/config";
import cors from "cors";
import express from "express";
import { apiRouter } from "./routes/api";

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/api", apiRouter);

export default app;
