// src/middlewares/validate.js
export const zodValidate =
  (schema, where = "body") =>
  (req, res, next) => {
    const result = schema.safeParse(req[where]);
    if (!result.success) {
      return res.status(400).json({
        error: "ValidationError",
        issues: result.error.flatten(),
      });
    }
    req[where] = result.data;
    next();
  };
