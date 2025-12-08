import { Request, Response } from "express";
import pool from "../config/database";

/**
 * GET /api/recursos/empleados
 * Lista todos los empleados activos
 * Consulta desde la tabla public.empleado que SÍ existe en BD compartida
 */
export const listarEmpleados = async (_req: Request, res: Response) => {
  try {
    const query = `
      SELECT 
        id_empleado as id,
        nombre,
        apellido,
        rol,
        email,
        telefono
      FROM public.empleado
      ORDER BY nombre, apellido
    `;

    const result = await pool.query(query);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("❌ Error al listar empleados:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener empleados",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

/**
 * GET /api/recursos/transportistas
 * Lista todos los transportistas activos
 * CONSULTA BD REAL: public.empleado (rol = TRANSPORTISTA)
 */
export const listarTransportistas = async (_req: Request, res: Response) => {
  try {
    const query = `
      SELECT
        id_empleado as id,
        nombre,
        apellido,
        rut,
        telefono,
        email
      FROM public.empleado
      WHERE rol = 'TRANSPORTISTA'
      ORDER BY nombre, apellido
    `;

    const result = await pool.query(query);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("❌ Error al listar transportistas:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener transportistas",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

/** GET /api/recursos/empleados-transportistas
 * Lista todos los empleados transportistas desde Logistica.log_transportistas
 */
export const listarEmpleadosTransportistas = async (
  _req: Request,
  res: Response
) => {
  try {
    const q = `
      SELECT
        id_empleado_transportista,
        id_empresa,
        rut_transportista,
        nombre,
        apellido,
        telefono,
        email
      FROM "Logistica".log_transportistas
      ORDER BY id_empresa, nombre, apellido
    `;

    const result = await pool.query(q);

    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) {
    console.error("❌ Error al listar empleados transportistas:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener empleados transportistas",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};
