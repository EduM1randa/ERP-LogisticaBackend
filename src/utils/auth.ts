import jwt from "jsonwebtoken";
import pool from "../config/database";

export const parseBearerToken = (req: any): any | null => {
  try {
    const auth = req.headers?.authorization || req.headers?.Authorization;
    if (!auth) return null;
    const parts = String(auth).split(" ");
    if (parts.length !== 2) return null;
    const token = parts[1];
    const secret = process.env.JWT_SECRET || "change_this_secret";
    const payload = jwt.verify(token, secret as unknown as jwt.Secret) as any;
    return payload ?? null;
  } catch (err) {
    return null;
  }
};

export const getEmpleadoIdFromToken = (req: any): number | null => {
  try {
    const payload = parseBearerToken(req);
    if (!payload) return null;
    const maybeId =
      payload.sub ?? payload.id_empleado ?? payload.empleado?.id_empleado;
    if (!maybeId) return null;
    const idNum = Number(maybeId);
    return Number.isNaN(idNum) ? null : idNum;
  } catch (err) {
    return null;
  }
};

export const getAuthEmpleado = async (
  req: any,
  clientOrPool?: { query: (q: string, params?: any[]) => Promise<any> }
): Promise<{
  id_empleado: number;
  rol: string;
  nombre?: string;
  apellido?: string;
} | null> => {
  try {
    const payload = parseBearerToken(req);
    if (!payload) return null;
    const maybeId =
      payload.sub ?? payload.id_empleado ?? payload.empleado?.id_empleado;
    if (!maybeId) return null;
    const idNum = Number(maybeId);
    if (Number.isNaN(idNum)) return null;

    const executor =
      clientOrPool && typeof clientOrPool.query === "function"
        ? clientOrPool
        : pool;
    const empQ = await executor.query(
      `SELECT id_empleado, rol, nombre, apellido FROM public.empleado WHERE id_empleado = $1 LIMIT 1`,
      [idNum]
    );
    if (empQ.rows.length === 0) return null;
    return {
      id_empleado: idNum,
      rol: String(empQ.rows[0].rol || "").toUpperCase(),
      nombre: empQ.rows[0].nombre,
      apellido: empQ.rows[0].apellido,
    };
  } catch (err) {
    return null;
  }
};

export default {
  parseBearerToken,
  getEmpleadoIdFromToken,
  getAuthEmpleado,
};
