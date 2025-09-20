import "./config/env.js";
import express from "express";
import cors from "cors";
import connectDB from "./db.js";
import cookieParser from "cookie-parser";
import studentRoutes from "./routes/student.routes.js";
import aiChat from "./routes/aiChat.js";
import adminDebug from "./routes/adminDebug.js";
import aiQuery from "./routes/aiQuery.js";
import PostPlacementRoutes from "./routes/postPlacement.js";
import postPlacementDataRoutes from "./routes/postPlacement.routes.js";
import hrRoutes from "./routes/hr.js";
import cloudinaryRoutes from "./routes/cloudinary.routes.js";
import EnrollmentRequest from "./routes/enrollments.js";
import prePlacementRoutes from "./routes/preplacement.js";
import demoUsersRouter from "./routes/demoUsers.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import adminUserRoutes from "./routes/adminUsers.js";
import authRoutes from "./routes/auth.js";
import contactsRoutes from "./routes/contacts.js";

const app = express();
const allowedOrigins = [
  "https://dashboard.itjobsfactory.com",
  "https://research.itjobsfactory.com",
];
//Middleware
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());

app.use("/api/students", studentRoutes);
app.use("/api", aiChat);
app.use("/api", adminDebug);
app.use("/api", aiQuery);
app.use("/api/offers", PostPlacementRoutes);
app.use("/api/post-placement", postPlacementDataRoutes);
app.use("/api/hr", hrRoutes);
app.use("/api/cloudinary", cloudinaryRoutes);
app.use("/api/enrollments", EnrollmentRequest);
app.use("/api/preplacement", prePlacementRoutes);
app.use("/api/demo-users", demoUsersRouter);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/admin", adminUserRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/contacts", contactsRoutes);

connectDB();

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
