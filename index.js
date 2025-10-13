import "./config/env.js";
import express from "express";
import cors from "cors";
import http from "http";
import { Server as SocketIOServer } from "socket.io";

import connectDB from "./db.js";
import cookieParser from "cookie-parser";

// Routers
import studentRoutes from "./routes/student.routes.js"; // should include POST /admission/personal, GET/:id/fee-status, POST/:id/accept-terms, etc.
import aiChat from "./routes/aiChat.js";
import adminDebug from "./routes/adminDebug.js";
import aiQuery from "./routes/aiQuery.js";
import PostPlacementRoutes from "./routes/postPlacement.js";
import postPlacementDataRoutes from "./routes/postPlacement.routes.js";
import hrRoutes from "./routes/hr.js";
import cloudinaryRoutes from "./routes/cloudinary.routes.js";
import hrStatsRoutes from "./routes/hrContacts.stats.js";
import prePlacementRoutes from "./routes/preplacement.js";
import demoUsersRouter from "./routes/demoUsers.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import adminUserRoutes from "./routes/adminUsers.js";
import authRoutes from "./routes/auth.js";
import contactsRoutes from "./routes/contacts.js";
import leadRoutes from "./routes/lead.routes.js";
import paymentRoutes from "./routes/payments.routes.js";
import timesheetAuthRouter from "./routes/timesheet_auth.js";
import workdayRoutes from "./routes/timesheet_workday.js";
import reportRoutes from "./routes/timesheet_reports.js";
import { Student } from "./models/student.model.js"; // for socket token check
import { clerkMiddleware } from "@clerk/express";
const app = express();

const allowedOrigins = [
  "https://dashboard.itjobsfactory.com",
  "https://www.itjobsfactory.com",
  "https://research.itjobsfactory.com",
  "https://placements.itjobsfactory.com",
  "https://timesheet.itjobsfactory.com",
];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());

/* -------------------- Socket.IO server -------------------- */
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: allowedOrigins, credentials: true },
});

// make io available inside every route via req.io
app.use((req, _res, next) => {
  req.io = io;
  next();
});

// small helper to validate a student's socket token
async function validateStudentToken(studentId, token) {
  try {
    const s = await Student.findById(studentId)
      .select("feeApproval.socketJoinToken")
      .lean();
    return !!s && s.feeApproval?.socketJoinToken === token;
  } catch {
    return false;
  }
}

// namespace for admissions flow
io.of("/admissions").on("connection", (socket) => {
  // Managers subscribe to a common room to receive new requests
  socket.on("join-management", () => {
    socket.join("managers");
  });

  // Students join their own room after step-1
  socket.on("join-student", async ({ studentId, token }) => {
    const ok = await validateStudentToken(studentId, token);
    if (!ok) return socket.disconnect(true);
    socket.join(`student:${studentId}`);
  });
});

/* -------------------- Routes -------------------- */
app.use("/api/students", studentRoutes);
app.use("/api", aiChat);
app.use("/api", adminDebug);
app.use("/api", aiQuery);
app.use("/api/offers", PostPlacementRoutes);
app.use("/api/post-placement", postPlacementDataRoutes);
app.use("/api/hr", hrRoutes);
app.use("/api/cloudinary", cloudinaryRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/preplacement", prePlacementRoutes);
app.use("/api/demo-users", demoUsersRouter);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/admin", adminUserRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/contacts", contactsRoutes);
app.use("/api/hr-contacts", hrStatsRoutes);
app.use("/api/payments", paymentRoutes);
app.use(clerkMiddleware());
app.use("/api", timesheetAuthRouter);
app.use("/api", workdayRoutes);
app.use("/api", reportRoutes);
/* -------------------- Init DB + start -------------------- */
connectDB();

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => console.log(`Server + Socket.IO on :${PORT}`));
