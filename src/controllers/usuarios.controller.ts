import { Request, Response } from "express";
import pool from "../config/database";

/**
 * GET /api/usuarios/empleados-logistica
 * Lista empleados con rol 'EMPLEADO_LOGISTICA' desde public.empleado
 */
export const listarEmpleadosLogistica = async (
  _req: Request,
  res: Response
) => {
  try {
    const query = `
      SELECT id_empleado as id, nombre, apellido, rol, email
      FROM public.empleado
      WHERE rol = 'EMPLEADO_LOGISTICA' AND estado = 'ACTIVO'
      ORDER BY nombre, apellido
    `;

    const result = await pool.query(query);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Error listarEmpleadosLogistica", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener empleados de logística",
    });
  }
};
