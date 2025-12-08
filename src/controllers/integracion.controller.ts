import { Request, Response } from "express";
import pool from "../config/database";

/**
 * Controlador para endpoints de integración con otros ERPs
 * Maneja la recepción de pedidos de ventas y órdenes de compra
 */

// ==================== PEDIDOS DE VENTAS ====================

/**
 * GET /api/integracion/pedidos-ventas
 * Lista todos los pedidos de ventas DESDE EL MÓDULO DE VENTAS
 * CONSULTA BD REAL: Ventas.ventas + Ventas.detalle_venta
 *
 * LÓGICA DE ESTADO:
 * - PENDIENTE: Pedidos que NO tienen una OT de Picking asignada
 * - PROCESADO: Pedidos que YA tienen una OT de Picking asignada
 */
export const listarPedidosVentas = async (_req: Request, res: Response) => {
  try {
    const query = `
      SELECT 
        v.id_venta as id,
        'PV-' || LPAD(v.id_venta::text, 6, '0') as numero_pedido,
        c.nombre || ' ' || c.apellido as cliente,
        c.direccion as direccion_despacho,
        CASE 
          WHEN EXISTS (
            SELECT 1 FROM "Logistica".log_ot_picking op 
            WHERE op.observaciones LIKE '%PV-' || LPAD(v.id_venta::text, 6, '0') || '%'
          ) THEN 'PROCESADO'
          ELSE 'PENDIENTE'
        END as estado,
        v.fecha_pedido,
        v.fecha_pedido as fecha_recepcion,
        'Forma de pago: ' || v.forma_de_pago || ' | Condiciones: ' || v.condiciones_de_pago as observaciones,
        COUNT(dv.id_producto) as cantidad_productos,
        v.total
      FROM "Ventas".ventas v
      INNER JOIN public.cliente c ON v.id_cliente = c.id_cliente
      LEFT JOIN "Ventas".detalle_venta dv ON v.id_venta = dv.id_venta
      GROUP BY v.id_venta, c.nombre, c.apellido, c.direccion, v.estado, 
               v.fecha_pedido, v.forma_de_pago, v.condiciones_de_pago, v.total
      ORDER BY v.fecha_pedido DESC
    `;

    const result = await pool.query(query);

    res.json({
      success: true,
      data: result.rows,
      total: result.rows.length,
    });
  } catch (error) {
    console.error("❌ Error al listar pedidos de ventas:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener pedidos de ventas",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

/**
 * GET /api/integracion/pedidos-ventas/:id
 * Obtiene un pedido de venta específico con sus detalles DESDE VENTAS
 */
export const obtenerPedidoVenta = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const q = `
      SELECT
        lr.id_recepcion,
        lr.id_orden_compra,
        lr.id_oc_proveedor,
        lr.id_proveedor,
        prov.nombre as proveedor,
        lr.fecha_oc,
        lr.total_compra,
        lr.estado_recepcion as estado,
        lr.fecha_registro_logistica,
        lr.fecha_recepcion_finalizada,
        lr.id_empleado_logistica,
        (e.nombre || ' ' || e.apellido) as empleado_logistica_nombre
      FROM "Logistica".log_recepcion lr
      LEFT JOIN public.proveedor prov ON lr.id_proveedor = prov.id_proveedor
      LEFT JOIN public.empleado e ON lr.id_empleado_logistica = e.id_empleado
      WHERE lr.id_recepcion = $1 OR lr.id_orden_compra = $1
      LIMIT 1
    `;

    const pedidoResult = await pool.query(q, [id]);

    if (pedidoResult.rows.length === 0) {
      res
        .status(404)
        .json({ success: false, message: "Recepción no encontrada" });
      return;
    }

    res.json({ success: true, data: pedidoResult.rows[0] });
  } catch (error) {
    console.error("❌ Error al obtener pedido de venta:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener pedido de venta",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

/**
 * POST /api/integracion/recibir-pedido-venta
 * Recibe un nuevo pedido desde el ERP de Ventas
 * NOTA: Este endpoint ya no se usa, los datos vienen directamente de Ventas.ventas
 */
export const recibirPedidoVenta = async (
  req: Request,
  res: Response
): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const {
      numero_pedido,
      cliente,
      direccion_despacho,
      fecha_pedido,
      observaciones,
      detalles,
    } = req.body;

    if (
      !numero_pedido ||
      !cliente ||
      !direccion_despacho ||
      !detalles ||
      detalles.length === 0
    ) {
      res.status(400).json({
        success: false,
        message:
          "Faltan datos requeridos: numero_pedido, cliente, direccion_despacho y detalles",
      });
      return;
    }

    // Insertar pedido
    const pedidoQuery = `
      INSERT INTO logistica.pedidos_ventas 
        (numero_pedido, cliente, direccion_despacho, estado, fecha_pedido, fecha_recepcion, observaciones)
      VALUES ($1, $2, $3, 'PENDIENTE', $4, CURRENT_TIMESTAMP, $5)
      RETURNING *
    `;
    const pedidoResult = await client.query(pedidoQuery, [
      numero_pedido,
      cliente,
      direccion_despacho,
      fecha_pedido || new Date(),
      observaciones || null,
    ]);

    const pedidoId = pedidoResult.rows[0].id;

    // Insertar detalles
    for (const detalle of detalles) {
      const detalleQuery = `
        INSERT INTO logistica.detalles_pedido_venta 
          (pedido_venta_id, producto_id, producto_nombre, cantidad, precio_unitario)
        VALUES ($1, $2, $3, $4, $5)
      `;
      await client.query(detalleQuery, [
        pedidoId,
        detalle.producto_id,
        detalle.producto_nombre,
        detalle.cantidad,
        detalle.precio_unitario,
      ]);
    }

    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      message: "Pedido de venta recibido correctamente",
      data: pedidoResult.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error al recibir pedido de venta:", error);
    res.status(500).json({
      success: false,
      message: "Error al recibir pedido de venta",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  } finally {
    client.release();
  }
};

// ==================== ÓRDENES DE COMPRA ====================

/**
 * GET /api/integracion/ordenes-compra
 * Lista todas las órdenes de compra DESDE EL MÓDULO DE COMPRAS
 * CONSULTA BD REAL: Compras.compras_oc + Compras.compras_detalle
 */
export const listarOrdenesCompra = async (_req: Request, res: Response) => {
  try {
    const query = `
      SELECT
        lr.id_recepcion as id_recepcion,
        lr.id_orden_compra,
        lr.id_oc_proveedor,
        lr.id_proveedor,
        prov.nombre as proveedor,
        lr.fecha_oc,
        lr.total_compra,
        lr.estado_recepcion as estado,
        lr.fecha_registro_logistica,
        lr.fecha_recepcion_finalizada,
        lr.id_empleado_logistica,
        (e.nombre || ' ' || e.apellido) as empleado_logistica_nombre
      FROM "Logistica".log_recepcion lr
      LEFT JOIN public.proveedor prov ON lr.id_proveedor = prov.id_proveedor
      LEFT JOIN public.empleado e ON lr.id_empleado_logistica = e.id_empleado
      ORDER BY lr.fecha_registro_logistica DESC
    `;

    const result = await pool.query(query);

    res.json({
      success: true,
      data: result.rows,
      total: result.rows.length,
    });
  } catch (error) {
    console.error("❌ Error al listar órdenes de compra:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener órdenes de compra",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

/**
 * PUT /api/integracion/recepcion/:id/recibir
 * Marca una recepción (log_recepcion) como RECIBIDA. Requiere auth.
 */
export const recibirRecepcion = async (
  req: Request,
  res: Response
): Promise<void> => {
  const client = await pool.connect();
  try {
    const auth = (req as any).empleado;
    if (!auth) {
      res
        .status(401)
        .json({ success: false, message: "Token inválido o no proporcionado" });
      return;
    }

    const allowedRoles = ["JEFE_LOGISTICA", "EMPLEADO_LOGISTICA"];
    if (!allowedRoles.includes(String(auth.rol || "").toUpperCase())) {
      res.status(403).json({
        success: false,
        message: "No autorizado para marcar recepción",
      });
      return;
    }

    const { id } = req.params;
    if (!id) {
      res
        .status(400)
        .json({ success: false, message: "Falta id de recepción" });
      return;
    }

    await client.query("BEGIN");

    const sel = await client.query(
      `SELECT * FROM "Logistica".log_recepcion WHERE id_recepcion = $1 OR id_orden_compra = $1 FOR UPDATE`,
      [id]
    );
    if (sel.rows.length === 0) {
      await client.query("ROLLBACK");
      res
        .status(404)
        .json({ success: false, message: "Recepción no encontrada" });
      return;
    }

    const recep = sel.rows[0];
    if (String(recep.estado_recepcion).toUpperCase() === "RECIBIDA") {
      await client.query("ROLLBACK");
      res.status(400).json({
        success: false,
        message: "La recepción ya está marcada como RECIBIDA",
      });
      return;
    }

    const update = await client.query(
      `UPDATE "Logistica".log_recepcion SET estado_recepcion = 'RECIBIDA', fecha_recepcion_finalizada = NOW(), id_empleado_logistica = $1 WHERE id_recepcion = $2 RETURNING *`,
      [auth.id_empleado, recep.id_recepcion]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Recepción marcada como RECIBIDA",
      data: update.rows[0],
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (e) {}
    console.error("Error al marcar recepción como RECIBIDA:", error);
    res.status(500).json({
      success: false,
      message: "Error al actualizar recepción",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  } finally {
    client.release();
  }
};
