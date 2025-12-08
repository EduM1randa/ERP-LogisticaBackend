import { Request, Response, NextFunction } from "express";
import { getAuthEmpleado, parseBearerToken } from "../utils/auth";

declare global {
  namespace Express {
    interface Request {
      empleado?: {
        id_empleado: number;
        rol: string;
        nombre?: string;
        apellido?: string;
      } | null;
      tokenPayload?: any;
    }
  }
}

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const payload = parseBearerToken(req);
    req.tokenPayload = payload;

    const auth = await getAuthEmpleado(req);
    if (!auth) {
      return res
        .status(401)
        .json({ success: false, message: "Token inválido o no proporcionado" });
    }
    req.empleado = auth;
    return next();
  } catch (err) {
    console.error("authMiddleware error:", err);
    return res.status(401).json({ success: false, message: "Token inválido" });
  }
};

export default authMiddleware;
