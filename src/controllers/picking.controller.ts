import { Request, Response } from "express";
import pool from "../config/database";
import { parseAndNormalizeToISO } from "../utils/dates";
import PDFDocument from "pdfkit";

/**
 * Obtener todas las órdenes de picking
 */
export const getAllOrdenesPicking = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const result = await pool.query(`
      SELECT 
        op.id_ot,
        op.id_empleado,
        e.nombre AS nombre_empleado,
        e.apellido AS apellido_empleado,
        op.fecha,
        op.estado,
        op.observaciones
      FROM "Logistica".log_ot_picking op
      LEFT JOIN public.empleado e ON op.id_empleado = e.id_empleado
      ORDER BY op.fecha DESC
    `);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    console.error("Error al obtener órdenes de picking:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener órdenes de picking",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * GET /api/picking/mis
 * Devuelve las OTs asignadas al empleado logueado (según token)
 */
export const getMisOrdenesPicking = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const empleadoId = (req as any).empleado?.id_empleado;
    if (!empleadoId) {
      res
        .status(401)
        .json({ success: false, message: "Token inválido o no proporcionado" });
      return;
    }

    const result = await pool.query(
      `
      SELECT
        op.id_ot,
        op.id_venta,
        op.id_empleado,
        e.nombre AS nombre_empleado,
        e.apellido AS apellido_empleado,
        op.fecha,
        op.estado,
        op.observaciones
      FROM "Logistica".log_ot_picking op
      LEFT JOIN public.empleado e ON op.id_empleado = e.id_empleado
      WHERE op.id_empleado = $1
      ORDER BY op.fecha DESC
    `,
      [empleadoId]
    );

    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) {
    console.error("Error al obtener mis OTs:", error);
    res.status(500).json({ success: false, message: "Error al obtener OTs" });
  }
};

/**
 * Obtener una orden de picking por ID
 */
export const getOrdenPickingById = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT 
        op.id_ot,
        op.id_empleado,
        e.nombre AS nombre_empleado,
        e.apellido AS apellido_empleado,
        op.fecha,
        op.estado,
        op.observaciones
      FROM "Logistica".log_ot_picking op
      LEFT JOIN public.empleado e ON op.id_empleado = e.id_empleado
      WHERE op.id_ot = $1
    `,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        message: "Orden de picking no encontrada",
      });
      return;
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error al obtener orden de picking:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener orden de picking",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Crear nueva orden de picking
 */
export const createOrdenPicking = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id_empleado, fecha, estado, observaciones } = req.body;

    if (!id_empleado || !fecha) {
      res.status(400).json({
        success: false,
        message:
          "Faltan campos requeridos: id_empleado y fecha son obligatorios",
      });
      return;
    }

    const empleadoCheck = await pool.query(
      "SELECT id_empleado FROM public.empleado WHERE id_empleado = $1",
      [id_empleado]
    );

    if (empleadoCheck.rows.length === 0) {
      res.status(400).json({
        success: false,
        message: "El empleado especificado no existe",
      });
      return;
    }

    const result = await pool.query(
      `
      INSERT INTO "Logistica".log_ot_picking (id_empleado, fecha, estado, observaciones)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `,
      [id_empleado, fecha, estado || "Pendiente", observaciones || null]
    );

    try {
      await pool.query(
        `INSERT INTO "Logistica".empleado_counters (id_empleado, tipo, counter)
           VALUES ($1, 'EMPLEADO_LOGISTICA', 1)
           ON CONFLICT (id_empleado) DO UPDATE
             SET counter = "Logistica".empleado_counters.counter + 1, updated_at = NOW()`,
        [id_empleado]
      );
    } catch (err) {
      console.error(
        "Error incrementando empleado_counters en createOrdenPicking",
        err
      );
    }

    res.status(201).json({
      success: true,
      message: "Orden de picking creada exitosamente",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error al crear orden de picking:", error);
    res.status(500).json({
      success: false,
      message: "Error al crear orden de picking",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Actualizar orden de picking
 */
export const updateOrdenPicking = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { estado, observaciones, fecha, id_empleado } = req.body;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const otQ = await client.query(
        `SELECT id_ot, id_empleado, fecha FROM "Logistica".log_ot_picking WHERE id_ot = $1 FOR UPDATE`,
        [id]
      );
      if (otQ.rows.length === 0) {
        await client.query("ROLLBACK");
        res
          .status(404)
          .json({ success: false, message: "Orden de picking no encontrada" });
        return;
      }

      const ot = otQ.rows[0];

      let normalizedFecha: string | undefined = undefined;
      if (fecha) {
        try {
          normalizedFecha = parseAndNormalizeToISO(fecha);
          const fechaActual = ot.fecha ? new Date(ot.fecha) : null;
          if (fechaActual) {
            // Allow 1 day leeway to avoid timezone drift errors
            const threshold = new Date(
              fechaActual.getTime() - 24 * 60 * 60 * 1000
            );
            if (new Date(normalizedFecha) < threshold) {
              await client.query("ROLLBACK");
              res.status(400).json({
                success: false,
                message:
                  "La nueva fecha no puede ser anterior a la fecha registrada",
              });
              return;
            }
          }
        } catch (err) {
          await client.query("ROLLBACK");
          res.status(400).json({ success: false, message: "Fecha inválida" });
          return;
        }
      }

      if (id_empleado && id_empleado !== ot.id_empleado) {
        try {
          await client.query(
            `UPDATE "Logistica".empleado_counters SET counter = GREATEST(counter - 1, 0), updated_at = NOW() WHERE id_empleado = $1`,
            [ot.id_empleado]
          );

          await client.query(
            `INSERT INTO "Logistica".empleado_counters (id_empleado, tipo, counter)
               VALUES ($1, 'EMPLEADO_LOGISTICA', 1)
               ON CONFLICT (id_empleado) DO UPDATE
                 SET counter = "Logistica".empleado_counters.counter + 1, updated_at = NOW()`,
            [id_empleado]
          );
        } catch (err) {
          console.error(
            "Error actualizando empleado_counters en updateOrdenPicking",
            err
          );
        }
      }

      const sets: string[] = [];
      const vals: any[] = [];
      let idx = 1;
      if (estado) {
        sets.push(`estado = $${idx++}`);
        vals.push(estado);
      }
      if (observaciones !== undefined) {
        sets.push(`observaciones = $${idx++}`);
        vals.push(observaciones);
      }
      if (fecha) {
        sets.push(`fecha = $${idx++}`);
        vals.push(normalizedFecha ?? new Date(fecha).toISOString());
      }
      if (id_empleado) {
        sets.push(`id_empleado = $${idx++}`);
        vals.push(id_empleado);
      }

      if (sets.length > 0) {
        const q = `UPDATE "Logistica".log_ot_picking SET ${sets.join(
          ", "
        )} WHERE id_ot = $${idx} RETURNING *`;
        vals.push(id);
        const updateRes = await client.query(q, vals);
        await client.query("COMMIT");
        res.json({
          success: true,
          message: "Orden de picking actualizada exitosamente",
          data: updateRes.rows[0],
        });
        return;
      }

      await client.query("COMMIT");
      res.json({ success: true, message: "Sin cambios" });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Error al actualizar orden de picking:", err);
      res.status(500).json({
        success: false,
        message: "Error al actualizar orden de picking",
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error al actualizar orden de picking:", error);
    res.status(500).json({
      success: false,
      message: "Error al actualizar orden de picking",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * GET /api/picking/:id/pdf
 * Genera y devuelve PDF con información de la OT
 */
type PDFAlign = "center" | "justify" | "left" | "right";

interface TableColumn {
  label?: string;
  text?: string;
  width: number;
  align: PDFAlign;
}

export const generarPdfPicking = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT 
        -- OT Picking Info
        op.id_ot,
        op.id_empleado,
        e.nombre AS nombre_empleado,
        e.apellido AS apellido_empleado,
        op.fecha AS fecha_ot,
        op.estado AS estado_ot,
        op.observaciones,
        op.id_venta,

        -- Venta Info
        v.fecha_pedido AS fecha_venta,
        v.estado AS estado_venta, 
        
        -- Cliente Info
        c.nombre AS nombre_cliente,
        c.apellido AS apellido_cliente,
        
        -- Dirección de Entrega Info
        d.direccion AS direccion_calle,
        d.numero AS direccion_numero,
        d.ciudad,
        d.region,
        d.comuna
        
      FROM "Logistica".log_ot_picking op
      LEFT JOIN public.empleado e ON op.id_empleado = e.id_empleado
      LEFT JOIN "Ventas".ventas v ON op.id_venta = v.id_venta
      LEFT JOIN public.cliente c ON v.id_cliente = c.id_cliente
      LEFT JOIN public.direccion d ON v.id_direccion = d.id_direccion
      
      WHERE op.id_ot = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: "OT no encontrada" });
      return;
    }

    const orden = result.rows[0];

    const detalleResult = await pool.query(
      `
      SELECT
        dv.cantidad,
        p.nombre AS nombre_producto,
        p.codigo AS codigo_producto
      FROM "Ventas".detalle_venta dv
      JOIN public.producto p ON dv.id_producto = p.id_producto
      WHERE dv.id_venta = $1
      `,
      [orden.id_venta]
    );

    const detalles = detalleResult.rows;

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="OT-${orden.id_ot}_${orden.nombre_cliente}.pdf"`
    );

    doc.pipe(res);

    // --- Estilo de Informe ---
    const primaryColor = "#001f4c";
    const startX = 50;
    const tableWidth = 510;
    const halfWidth = tableWidth / 2;

    // --- Encabezado ---
    doc
      .fillColor(primaryColor)
      .fontSize(20)
      .font("Helvetica-Bold")
      .text(`ORDEN DE TRABAJO (PICKING) #${orden.id_ot}`, { align: "center" });
    doc.moveDown(0.5);

    doc
      .fillColor("#6b7280")
      .fontSize(10)
      .font("Helvetica")
      .text(`Generado el: ${new Date().toLocaleString()}`, { align: "right" });
    doc.moveDown(1);

    // --- Sección 1: Identificación y Responsable ---
    doc
      .fillColor(primaryColor)
      .fontSize(14)
      .font("Helvetica-Bold")
      .text("1. Datos de la Venta y Trazabilidad", startX);
    doc.moveDown(0.5);

    doc.fillColor("#1f2937").fontSize(11);
    const line1Y = doc.y;

    doc
      .font("Helvetica-Bold")
      .text(`ID Venta/Pedido:`, startX, line1Y, { continued: true });
    let currentX = doc.x;
    doc.font("Helvetica").text(`PV-${orden.id_venta}`, currentX, line1Y);

    doc
      .font("Helvetica-Bold")
      .text(`Fecha de Pedido:`, startX + halfWidth, line1Y, {
        continued: true,
      });
    currentX = doc.x;
    doc
      .font("Helvetica")
      .text(
        `${
          orden.fecha_venta
            ? new Date(orden.fecha_venta).toLocaleDateString()
            : "-"
        }`,
        currentX,
        line1Y
      );
    doc.moveDown(0.2);

    const line2Y = doc.y;

    doc
      .font("Helvetica-Bold")
      .text(`OT Creada:`, startX, line2Y, { continued: true });
    currentX = doc.x; // Capturar X
    doc
      .font("Helvetica")
      .text(
        `${orden.fecha_ot ? new Date(orden.fecha_ot).toLocaleString() : "-"}`,
        currentX,
        line2Y
      );

    doc
      .font("Helvetica-Bold")
      .text(`Responsable Asignado:`, startX + halfWidth, line2Y, {
        continued: true,
      });
    currentX = doc.x;
    doc
      .font("Helvetica")
      .text(
        `${orden.nombre_empleado || ""} ${orden.apellido_empleado || ""} (ID: ${
          orden.id_empleado ?? "-"
        })`,
        currentX,
        line2Y
      );
    doc.moveDown(1);

    // --- Sección 2: Destino de la Entrega ---
    doc
      .fillColor(primaryColor)
      .fontSize(14)
      .font("Helvetica-Bold")
      .text("2. Destino y Cliente", startX);
    doc.moveDown(0.5);

    doc.fillColor("#1f2937").fontSize(11).font("Helvetica");

    doc
      .font("Helvetica-Bold")
      .text(`Cliente:`, startX, doc.y, { continued: true });
    currentX = doc.x;
    doc
      .font("Helvetica")
      .text(
        `${orden.nombre_cliente || ""} ${orden.apellido_cliente || ""}`,
        currentX,
        doc.y
      );
    doc.moveDown(0.2);

    const direccionCompleta = `${orden.direccion_calle} ${orden.direccion_numero}, ${orden.comuna}, ${orden.region}`;
    doc
      .font("Helvetica-Bold")
      .text(`Dirección de Entrega:`, startX, doc.y, { continued: true });
    currentX = doc.x;
    doc.font("Helvetica").text(direccionCompleta, currentX, doc.y);
    doc.moveDown(1);

    // --- Sección 3: Listado de Picking y Verificación ---
    doc
      .fillColor(primaryColor)
      .fontSize(14)
      .font("Helvetica-Bold")
      .text("3. Productos a Recoger (Picking List)", startX);
    doc.moveDown(0.5);

    const tableTop = doc.y;
    const itemHeight = 25;
    let currentY = tableTop;

    doc.fillColor("#1f2937").font("Helvetica-Bold").fontSize(10);

    const headers: TableColumn[] = [
      { label: "SKU / Código", width: 120, align: "left" },
      { label: "Producto", width: 220, align: "left" },
      { label: "Cantidad Solicitada", width: 80, align: "center" },
      { label: "Cantidad Recogida", width: 90, align: "center" },
    ];

    let x = startX;
    headers.forEach((header) => {
      doc.text(header.label!, x, currentY, {
        width: header.width,
        align: header.align,
      });
      x += header.width;
    });

    currentY += itemHeight * 0.7;

    doc
      .strokeColor("#d1d5db")
      .lineWidth(1)
      .moveTo(startX, currentY)
      .lineTo(startX + tableWidth, currentY)
      .stroke();

    currentY += 5;

    doc.font("Helvetica").fontSize(10).fillColor("#4b5563");

    detalles.forEach((item, index) => {
      x = startX;
      const rowData: TableColumn[] = [
        { text: item.codigo_producto, width: 120, align: "left" },
        { text: item.nombre_producto, width: 220, align: "left" },
        { text: item.cantidad.toString(), width: 80, align: "center" },
        { text: "___", width: 90, align: "center" },
      ];

      rowData.forEach((col) => {
        doc.text(col.text!, x, currentY, {
          width: col.width,
          align: col.align,
        });
        x += col.width;
      });

      currentY += itemHeight * 0.8;

      doc
        .strokeColor("#f3f4f6")
        .lineWidth(0.5)
        .moveTo(startX, currentY - 2)
        .lineTo(startX + tableWidth, currentY - 2)
        .stroke();

      if (currentY > 750) {
        doc.addPage();
        currentY = 50;
      }
    });

    doc.moveDown(2);

    // --- Sección 4: Observaciones y Estado ---

    doc
      .fillColor(primaryColor)
      .fontSize(14)
      .font("Helvetica-Bold")
      .text("4. Estado y Observaciones", startX);
    doc.moveDown(0.5);

    doc.fillColor("#1f2937").fontSize(11);

    const estadoY = doc.y;

    doc
      .font("Helvetica-Bold")
      .text(`Estado de la OT:`, startX, estadoY, { continued: true });
    currentX = doc.x;
    doc.font("Helvetica").text(`${orden.estado_ot || "-"}`, currentX, estadoY);

    doc
      .font("Helvetica-Bold")
      .text(`Estado de la Venta:`, startX + halfWidth, estadoY, {
        continued: true,
      });
    currentX = doc.x;
    doc
      .font("Helvetica")
      .text(`${orden.estado_venta || "-"}`, currentX, estadoY);

    doc.moveDown(1);

    doc
      .font("Helvetica-Bold")
      .text("Observaciones Adicionales:", startX, doc.y, { continued: true });
    currentX = doc.x;
    doc
      .font("Helvetica")
      .text(
        orden.observaciones || "Sin observaciones específicas de la OT.",
        currentX,
        doc.y
      );
    doc.moveDown(10);

    // --- Sección 5: Firma de Verificación ---
    doc.fillColor("#1f2937").font("Helvetica").fontSize(10);

    const signatureY = doc.y;

    doc
      .strokeColor("#000000")
      .lineWidth(1)
      .moveTo(200, signatureY)
      .lineTo(400, signatureY)
      .stroke();

    doc.moveDown(0.2);
    doc.text(
      "Firma y Verificación del Empleado Logística (Picker)",
      200,
      doc.y,
      { width: 200, align: "center" }
    );
    doc.text(
      `ID Empleado: ${orden.id_empleado ?? "________________"}`,
      200,
      doc.y + 15,
      { width: 200, align: "center" }
    );

    doc.end();
  } catch (error) {
    console.error("Error generarPdfPicking:", error);
    res.status(500).json({ success: false, message: "Error al generar PDF" });
  }
};
