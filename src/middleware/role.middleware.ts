import { Request, Response, NextFunction } from "express";

export const requireRole = (...allowedRoles: string[]) => {
  const allowedUpper = allowedRoles.map((r) => r.toUpperCase());
  return (req: Request, res: Response, next: NextFunction) => {
    const rol = (req as any).empleado?.rol ?? "";
    if (!rol || !allowedUpper.includes(String(rol).toUpperCase())) {
      return res.status(403).json({ success: false, message: "No autorizado" });
    }
    return next();
  };
};

export default requireRole;
