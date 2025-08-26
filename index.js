import "./config/env.js";
import express from "express";
import cors from "cors";
import connectDB from "./db.js";
import preOldRoutes from "./routes/prePlacementOldData.routes.js";
import studentRoutes from "./routes/student.routes.js";
import aiChat from "./routes/aiChat.js";
import adminDebug from "./routes/adminDebug.js";
import aiQuery from "./routes/aiQuery.js";
import PostPlacementRoutes from "./routes/postPlacement.js";
import postPlacementDataRoutes from "./routes/postPlacement.routes.js";
import hrRoutes from "./routes/hr.js";

const app = express();

//Middleware
app.use(
  cors({
    origin: ["https://dashboard.itjobsfactory.com"],
    credentials: true,
  })
);

app.use(express.json());
app.use("/api/pre-old", preOldRoutes);
app.use("/api/students", studentRoutes);
app.use("/api", aiChat);
app.use("/api", adminDebug);
app.use("/api", aiQuery);
app.use("/api/offers", PostPlacementRoutes);
app.use("/api/post-placement", postPlacementDataRoutes);
app.use("/api/hr", hrRoutes);

connectDB();

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
