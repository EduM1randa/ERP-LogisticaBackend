import { Request, Response } from "express";
import pool from "../config/database";
import PDFDocument from "pdfkit";

/**
 * Obtener todas las guías de despacho
 */
export const getAllGuiasDespacho = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const result = await pool.query(`
      SELECT 
        gd.id_guia,
        gd.id_encargado,
        gd.id_ot,
        gd.fecha,
        gd.id_transportista,
        (eT.nombre || ' ' || eT.apellido) AS transportista_nombre,
        (lt.nombre || ' ' || lt.apellido) AS encargado_name,
        gd.direccion_entrega,
        gd.estado AS estado,
        op.estado AS estado_ot
      FROM "Logistica".log_guia_despacho gd
      LEFT JOIN "Logistica".log_ot_picking op ON gd.id_ot = op.id_ot
      LEFT JOIN "Logistica".log_transportistas lt ON gd.id_encargado = lt.id_empleado_transportista
      LEFT JOIN public.empleado eT ON gd.id_transportista = eT.id_empleado
      ORDER BY gd.fecha DESC
    `);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    console.error("Error al obtener guías de despacho:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener guías de despacho",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Obtener una guía de despacho por ID
 */
export const getGuiaDespachoById = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT 
        gd.id_guia,
        gd.id_encargado,
        gd.id_ot,
        gd.fecha,
        gd.id_transportista,
        (eT.nombre || ' ' || eT.apellido) AS transportista_nombre,
        (lt.nombre || ' ' || lt.apellido) AS encargado_name,
        gd.direccion_entrega,
        gd.estado AS estado,
        op.estado AS estado_ot,
        op.id_empleado,
        e.nombre AS nombre_empleado,
        e.apellido AS apellido_empleado
      FROM "Logistica".log_guia_despacho gd
      LEFT JOIN "Logistica".log_ot_picking op ON gd.id_ot = op.id_ot
      LEFT JOIN public.empleado e ON op.id_empleado = e.id_empleado
      LEFT JOIN public.empleado eT ON gd.id_transportista = eT.id_empleado
      LEFT JOIN "Logistica".log_transportistas lt ON gd.id_encargado = lt.id_empleado_transportista
      WHERE gd.id_guia = $1
    `,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        message: "Guía de despacho no encontrada",
      });
      return;
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error al obtener guía de despacho:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener guía de despacho",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Crear nueva guía de despacho
 * VALIDACIÓN: No permitir crear guía si la OT no existe o no está activa
 */
export const createGuiaDespacho = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id_ot, fecha, id_transportista, direccion_entrega } = req.body;

    if (!id_ot || !fecha) {
      res.status(400).json({
        success: false,
        message: "Faltan campos requeridos: id_ot y fecha son obligatorios",
      });
      return;
    }

    const otCheck = await pool.query(
      `SELECT id_ot, estado FROM "Logistica".log_ot_picking WHERE id_ot = $1`,
      [id_ot]
    );

    if (otCheck.rows.length === 0) {
      res.status(400).json({
        success: false,
        message:
          "No se puede crear la guía de despacho: la Orden de Trabajo (OT) especificada no existe",
      });
      return;
    }

    const estadoOT = otCheck.rows[0].estado;
    if (estadoOT === "CANCELADA") {
      res.status(400).json({
        success: false,
        message: "No se puede crear guía de despacho para una OT cancelada",
      });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const guiaEstado = estadoOT !== "COMPLETADA" ? "EN_PICKING" : "PENDIENTE";
      const idTransportistaToInsert =
        estadoOT !== "COMPLETADA" ? null : id_transportista || null;

      const insertRes = await client.query(
        `
        INSERT INTO "Logistica".log_guia_despacho (id_ot, fecha, id_transportista, direccion_entrega, estado)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `,
        [
          id_ot,
          fecha,
          idTransportistaToInsert,
          direccion_entrega || null,
          guiaEstado,
        ]
      );

      const guia = insertRes.rows[0];

      if (idTransportistaToInsert) {
        const otRes = await client.query(
          `SELECT estado FROM "Logistica".log_ot_picking WHERE id_ot = $1 LIMIT 1`,
          [guia.id_ot]
        );
        const otEstado = otRes.rows.length > 0 ? otRes.rows[0].estado : null;
        if (otEstado && otEstado !== "COMPLETADA") {
          await client.query("ROLLBACK");
          res.status(400).json({
            success: false,
            message:
              "No se puede asignar/cambiar transportista mientras la OT esté en EN_PICKING",
          });
          return;
        }
        const empleadoId = Number(idTransportistaToInsert);

        if (!Number.isNaN(empleadoId) && empleadoId > 0) {
          try {
            await client.query(
              `INSERT INTO "Logistica".empleado_counters (id_empleado, tipo, counter, updated_at)
                 VALUES ($1, 'TRANSPORTISTA', 1, NOW())
                 ON CONFLICT (id_empleado) DO UPDATE
                   SET counter = "Logistica".empleado_counters.counter + 1, updated_at = NOW()`,
              [empleadoId]
            );
          } catch (err) {
            console.error(
              "Error incrementando empleado_counters en createGuiaDespacho",
              err
            );
          }
        }
      }

      await client.query("COMMIT");

      res.status(201).json({
        success: true,
        message: "Guía de despacho creada exitosamente",
        data: guia,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Error al crear guía de despacho (transacción):", err);
      res.status(500).json({
        success: false,
        message: "Error al crear guía de despacho",
        error: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error al crear guía de despacho:", error);
    res.status(500).json({
      success: false,
      message: "Error al crear guía de despacho",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * GET /api/despacho/mis
 * Devuelve las guías asociadas al transportista logueado (según token)
 */
export const getMisGuiasDespacho = async (
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
        gd.id_guia,
        gd.id_encargado,
        gd.id_ot,
        gd.fecha,
        gd.id_transportista,
        (eT.nombre || ' ' || eT.apellido) AS transportista_nombre,
        (lt.nombre || ' ' || lt.apellido) AS encargado_name,
        gd.direccion_entrega,
        gd.estado AS estado,
        op.estado AS estado_ot
      FROM "Logistica".log_guia_despacho gd
      LEFT JOIN "Logistica".log_ot_picking op ON gd.id_ot = op.id_ot
      LEFT JOIN public.empleado eT ON gd.id_transportista = eT.id_empleado
      LEFT JOIN "Logistica".log_transportistas lt ON gd.id_encargado = lt.id_empleado_transportista
      WHERE gd.id_transportista = $1
      ORDER BY gd.fecha DESC
    `,
      [empleadoId]
    );

    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) {
    console.error("Error al obtener mis guías:", error);
    res.status(500).json({ success: false, message: "Error al obtener guías" });
  }
};

/**
 * GET /api/despacho/transportistas/:id_empresa
 * Lista los transportistas registrados en "Logistica".log_transportistas para una empresa dada
 */
export const getTransportistasByEmpresa = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id_empresa } = req.params;
    if (!id_empresa) {
      res
        .status(400)
        .json({ success: false, message: "Falta id_empresa en la ruta" });
      return;
    }

    const q = `
      SELECT id_empleado_transportista, id_empresa, id_empleado, nombre, apellido, telefono
      FROM "Logistica".log_transportistas
      WHERE id_empresa = $1
      ORDER BY nombre ASC, apellido ASC
    `;

    const result = await pool.query(q, [id_empresa]);

    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) {
    console.error("Error al obtener transportistas por empresa:", error);
    res
      .status(500)
      .json({ success: false, message: "Error al obtener transportistas" });
  }
};

type PDFAlign = "center" | "justify" | "left" | "right";

interface TableColumn {
  label?: string;
  text?: string;
  width: number;
  align: PDFAlign;
}

const primaryColor = "#001f4c";
const startX = 50;
const tableWidth = 510;
const halfWidth = tableWidth / 2;

/**
 * GET /api/despacho/:id/pdf
 * Genera y devuelve PDF con información de la guía
 */
export const generarPdfGuia = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT 
        -- Guía de Despacho (GD) Info
        gd.id_guia,
        gd.id_ot,
        gd.fecha AS fecha_guia,
        gd.estado AS estado_guia,
        gd.direccion_entrega AS direccion_guia,
        
        -- Transportista (Empresa) Info (desde public.empleado)
        eT.nombre AS nombre_empresa,
        eT.apellido AS apellido_empresa,
        
        -- Encargado (Conductor) Info (desde log_transportistas)
        lt.nombre AS nombre_encargado,
        lt.apellido AS apellido_encargado,
        lt.rut_transportista AS rut_encargado,

        -- OT Picking Info
        op.id_venta,
        op.estado AS estado_ot,

        -- Cliente Info
        c.nombre AS nombre_cliente,
        c.apellido AS apellido_cliente,
        c.telefono AS telefono_cliente,
        
        -- Dirección de Entrega Info (Desde la tabla Direccion por si hay que contrastar)
        d.ciudad,
        d.comuna
        
      FROM "Logistica".log_guia_despacho gd
      -- UNION 1: OT Picking (para obtener id_venta)
      LEFT JOIN "Logistica".log_ot_picking op ON gd.id_ot = op.id_ot
      -- UNION 2: Transportista (Empresa) (id_transportista -> public.empleado)
      LEFT JOIN public.empleado eT ON gd.id_transportista = eT.id_empleado
      -- UNION 3: Encargado (Conductor) (id_encargado -> log_transportistas)
      LEFT JOIN "Logistica".log_transportistas lt ON gd.id_encargado = lt.id_empleado_transportista
      -- UNION 4: Venta (para obtener id_cliente)
      LEFT JOIN "Ventas".ventas v ON op.id_venta = v.id_venta
      -- UNION 5: Cliente
      LEFT JOIN public.cliente c ON v.id_cliente = c.id_cliente
      -- UNION 6: Dirección (Para obtener ciudad/comuna)
      LEFT JOIN public.direccion d ON v.id_direccion = d.id_direccion
      
      WHERE gd.id_guia = $1
    `,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: "Guía no encontrada" });
      return;
    }

    const guia = result.rows[0];

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
      [guia.id_venta]
    );

    const detalles = detalleResult.rows;

    // 2. Configuración del PDF
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Guia-${guia.id_guia}_${guia.nombre_cliente}.pdf"`
    );

    doc.pipe(res);

    // --- Encabezado ---
    doc
      .fillColor(primaryColor)
      .fontSize(20)
      .font("Helvetica-Bold")
      .text(`GUÍA DE DESPACHO - GD #${guia.id_guia}`, { align: "center" });
    doc.moveDown(0.5);

    doc
      .fillColor("#6b7280")
      .fontSize(10)
      .font("Helvetica")
      .text(`Generado el: ${new Date().toLocaleString()}`, { align: "right" });
    doc.moveDown(1);

    // --- Sección 1: Datos de la Venta y Documento ---
    doc
      .fillColor(primaryColor)
      .fontSize(14)
      .font("Helvetica-Bold")
      .text("1. Documento y Trazabilidad", startX);
    doc.moveDown(0.5);

    doc.fillColor("#1f2937").fontSize(11);
    const line1Y = doc.y;

    doc
      .font("Helvetica-Bold")
      .text(`OT de Picking:`, startX, line1Y, { continued: true });
    let currentX = doc.x;
    doc
      .font("Helvetica")
      .text(`#${guia.id_ot} (${guia.estado_ot || "N/A"})`, currentX, line1Y);

    doc
      .font("Helvetica-Bold")
      .text(`Estado de la Guía:`, startX + halfWidth, line1Y, {
        continued: true,
      });
    currentX = doc.x;
    doc
      .font("Helvetica")
      .text(`${guia.estado_guia || "PENDIENTE"}`, currentX, line1Y);
    doc.moveDown(0.2);

    const line2Y = doc.y;

    doc
      .font("Helvetica-Bold")
      .text(`ID Venta/Pedido:`, startX, line2Y, { continued: true });
    currentX = doc.x;
    doc.font("Helvetica").text(`PV-${guia.id_venta}`, currentX, line2Y);

    doc
      .font("Helvetica-Bold")
      .text(`Fecha de Despacho:`, startX + halfWidth, line2Y, {
        continued: true,
      });
    currentX = doc.x;
    doc
      .font("Helvetica")
      .text(
        `${
          guia.fecha_guia
            ? new Date(guia.fecha_guia).toLocaleDateString()
            : "N/A"
        }`,
        currentX,
        line2Y
      );
    doc.moveDown(1);

    // --- Sección 2: Información de Transporte y Contacto ---
    doc
      .fillColor(primaryColor)
      .fontSize(14)
      .font("Helvetica-Bold")
      .text("2. Transporte y Contacto", startX);
    doc.moveDown(0.5);

    doc.fillColor("#1f2937").fontSize(11).font("Helvetica");

    const line3Y = doc.y;

    doc
      .font("Helvetica-Bold")
      .text(`Empresa Transportista:`, startX, line3Y, { continued: true });
    currentX = doc.x;
    doc
      .font("Helvetica")
      .text(`${guia.nombre_empresa || "NO ASIGNADA"}`, currentX, line3Y);

    const nombreCompletoEncargado = `${guia.nombre_encargado || ""} ${
      guia.apellido_encargado || ""
    }`;
    doc
      .font("Helvetica-Bold")
      .text(`Conductor Encargado:`, startX + halfWidth, line3Y, {
        continued: true,
      });
    currentX = doc.x;
    doc
      .font("Helvetica")
      .text(nombreCompletoEncargado || "N/A", currentX, line3Y);
    doc.moveDown(0.2);

    const line4Y = doc.y;

    doc
      .font("Helvetica-Bold")
      .text(`RUT Conductor:`, startX, line4Y, { continued: true });
    currentX = doc.x;
    doc.font("Helvetica").text(guia.rut_encargado || "N/A", currentX, line4Y);

    doc
      .font("Helvetica-Bold")
      .text(`Teléfono Cliente:`, startX + halfWidth, line4Y, {
        continued: true,
      });
    currentX = doc.x;
    doc
      .font("Helvetica")
      .text(guia.telefono_cliente || "N/A", currentX, line4Y);
    doc.moveDown(1);

    // --- Sección 3: Dirección y Destino ---
    doc
      .fillColor(primaryColor)
      .fontSize(14)
      .font("Helvetica-Bold")
      .text("3. Destino de la Mercancía", startX);
    doc.moveDown(0.5);

    doc.fillColor("#1f2937").fontSize(11).font("Helvetica");

    const labelCliente = `Cliente Final:`;
    doc
      .font("Helvetica-Bold")
      .text(labelCliente, startX, doc.y, { continued: true });
    currentX = doc.x;
    doc
      .font("Helvetica")
      .text(
        `${guia.nombre_cliente || ""} ${guia.apellido_cliente || ""}`,
        currentX,
        doc.y
      );
    doc.moveDown(0.2);

    const labelDireccion = `Dirección de Entrega:`;
    doc
      .font("Helvetica-Bold")
      .text(labelDireccion, startX, doc.y, { continued: true });
    currentX = doc.x;

    doc
      .font("Helvetica")
      .text(
        guia.direccion_guia || "Dirección no registrada en la Guía",
        currentX,
        doc.y
      );
    doc.moveDown(0.2);

    const labelUbicacion = `Ubicación:`;
    doc
      .font("Helvetica-Bold")
      .text(labelUbicacion, startX, doc.y, { continued: true });
    currentX = doc.x;
    doc
      .font("Helvetica")
      .text(
        `${guia.comuna || "N/A"}, ${guia.ciudad || "N/A"}`,
        currentX,
        doc.y
      );
    doc.moveDown(1);

    // --- Sección 4: Detalle de Productos ---
    doc
      .fillColor(primaryColor)
      .fontSize(14)
      .font("Helvetica-Bold")
      .text("4. Detalle de Productos Despachados", startX);
    doc.moveDown(0.5);

    // --- Dibujar la Tabla de Productos ---
    const tableTop = doc.y;
    const itemHeight = 25;
    let currentY = tableTop;

    doc.fillColor("#1f2937").font("Helvetica-Bold").fontSize(10);

    const headers: TableColumn[] = [
      { label: "SKU / Código", width: 120, align: "left" },
      { label: "Producto", width: 270, align: "left" },
      { label: "Cantidad Despachada", width: 120, align: "center" },
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
        { text: item.nombre_producto, width: 270, align: "left" },
        { text: item.cantidad.toString(), width: 120, align: "center" },
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

    doc.moveDown(10);

    const signatureY = doc.y;

    doc.text("Firma Conductor", 100, signatureY + 15, {
      width: 100,
      align: "center",
    });
    doc
      .strokeColor("#000000")
      .lineWidth(1)
      .moveTo(100, signatureY)
      .lineTo(250, signatureY)
      .stroke();

    doc.text("Firma Cliente (Receptor)", 350, signatureY + 15, {
      width: 150,
      align: "center",
    });
    doc
      .strokeColor("#000000")
      .lineWidth(1)
      .moveTo(350, signatureY)
      .lineTo(500, signatureY)
      .stroke();

    doc.end();
  } catch (error) {
    console.error("Error generarPdfGuia:", error);
    res.status(500).json({ success: false, message: "Error al generar PDF" });
  }
};
