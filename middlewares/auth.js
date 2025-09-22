// src/middlewares/auth.js   (make sure your imports use "middlewares" plural)
import jwt from "jsonwebtoken";

export function requireAuth(req, res, next) {
  const token = req.cookies?.auth;
  if (!token) return res.status(401).json({ error: "Unauthenticated" });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.sub;
    req.role = payload.role; // "admin" | "employee" | "verifier"
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.role || !roles.includes(req.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}
