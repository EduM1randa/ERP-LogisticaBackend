import { Request, Response } from "express";
import pool from "../config/database";
import { parseAndNormalizeToISO } from "../utils/dates";

/**
 * POST /api/automatizacion/procesar-pedido
 * Procesa un pedido de venta automáticamente
 */
export const procesarPedidoAutomatico = async (
  req: Request,
  res: Response
): Promise<void> => {
  const client = await pool.connect();

  try {
    const { id_venta } = req.body;

    if (!id_venta) {
      res.status(400).json({
        success: false,
        message: "El campo id_venta es requerido",
      });
      return;
    }

    console.log(
      `\n🤖 Iniciando procesamiento automático del pedido #${id_venta}...`
    );

    await client.query("BEGIN");

    // ==================================================================
    // PASO 1: Obtener datos del pedido de venta
    // ==================================================================
    console.log("📦 Paso 1: Obteniendo datos del pedido...");

    const pedidoQuery = await client.query(
      `
      SELECT 
        v.id_venta,
        v.id_cliente,
        v.id_direccion,
        v.fecha_pedido,
        v.total,
        v.estado as estado_venta,
        c.nombre as cliente_nombre,
        c.apellido as cliente_apellido,
        c.direccion,
        c.telefono,
        c.email
      FROM "Ventas".ventas v
      INNER JOIN public.cliente c ON v.id_cliente = c.id_cliente
      WHERE v.id_venta = $1
    `,
      [id_venta]
    );

    if (pedidoQuery.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({
        success: false,
        message: `Pedido de venta #${id_venta} no encontrado`,
      });
      return;
    }

    const pedido = pedidoQuery.rows[0];
    const numeroPedido = `PV-${String(pedido.id_venta).padStart(6, "0")}`;
    const clienteCompleto = `${pedido.cliente_nombre} ${
      pedido.cliente_apellido || ""
    }`.trim();

    const otExistente = await client.query(
      `
      SELECT id_ot 
      FROM "Logistica".log_ot_picking 
      WHERE observaciones LIKE $1
      LIMIT 1
    `,
      [`%${numeroPedido}%`]
    );

    if (otExistente.rows.length > 0) {
      await client.query("ROLLBACK");
      res.status(400).json({
        success: false,
        message: `Ya existe una OT para el pedido ${numeroPedido} (OT #${otExistente.rows[0].id_ot})`,
      });
      return;
    }

    // ==================================================================
    // PASO 2: Seleccionar empleado_logistica desde public.empleado (balanceo por OT pendientes)
    // ==================================================================
    const empleadoCuentaQ = await client.query(`
      SELECT e.id_empleado as id_empleado, e.nombre, e.apellido, e.email, ec.counter
      FROM public.empleado e
      LEFT JOIN "Logistica".empleado_counters ec
        ON ec.id_empleado = e.id_empleado AND ec.tipo = 'EMPLEADO_LOGISTICA'
      WHERE e.rol = 'EMPLEADO_LOGISTICA'
      ORDER BY (ec.counter IS NOT NULL) ASC, COALESCE(ec.counter, 0) ASC, e.id_empleado ASC
      LIMIT 1
    `);

    const empleadoCuenta =
      empleadoCuentaQ.rows.length > 0 ? empleadoCuentaQ.rows[0] : null;

    const empleadoInfo = empleadoCuenta
      ? (
          await client.query(
            `SELECT nombre, apellido FROM public.empleado WHERE id_empleado = $1 LIMIT 1`,
            [empleadoCuenta.id_empleado]
          )
        ).rows[0] || { nombre: "", apellido: "" }
      : { nombre: "", apellido: "" };

    // ==================================================================
    // PASO 3: Crear Orden de Trabajo automáticamente (estado 'En proceso')
    // ==================================================================
    const observacionesOT = `Pedido: ${numeroPedido} | Cliente: ${clienteCompleto} | Dirección: ${
      pedido.direccion || "No especificada"
    }`;

    const estadoInicialOt = empleadoCuenta ? "ASIGNADA" : "CREADA";
    const empleadoAsignadoId = empleadoCuenta
      ? empleadoCuenta.id_empleado
      : null;

    // Insertar OT vinculada al id_venta
    const otResult = await client.query(
      `
      INSERT INTO "Logistica".log_ot_picking
        (id_venta, id_empleado, fecha, estado, observaciones)
      VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4)
      RETURNING *
    `,
      [id_venta, empleadoAsignadoId, estadoInicialOt, observacionesOT]
    );

    const nuevaOT = otResult.rows[0];

    if (estadoInicialOt === "ASIGNADA" && empleadoAsignadoId) {
      try {
        await client.query(
          `INSERT INTO "Logistica".empleado_counters (id_empleado, tipo, counter)
             VALUES ($1, 'EMPLEADO_LOGISTICA', 1)
             ON CONFLICT (id_empleado) DO UPDATE
               SET counter = "Logistica".empleado_counters.counter + 1, updated_at = NOW()`,
          [empleadoAsignadoId]
        );
      } catch (err) {
        console.error("Error incrementando empleado_counters al crear OT", err);
      }
    }

    // ==================================================================
    // PASO 4: Seleccionar transportista con menos pedidos_asignados
    // ==================================================================
    const transportistaQ = await client.query(`
      SELECT e.id_empleado as id_transportista, e.nombre, e.apellido, e.rut, ec.counter
      FROM public.empleado e
      LEFT JOIN "Logistica".empleado_counters ec
        ON ec.id_empleado = e.id_empleado AND ec.tipo = 'TRANSPORTISTA'
      WHERE e.rol = 'TRANSPORTISTA'
      ORDER BY (ec.counter IS NOT NULL) ASC, COALESCE(ec.counter, 0) ASC, e.id_empleado ASC
      LIMIT 1
    `);

    const transportistaAsignado =
      transportistaQ.rows.length > 0 ? transportistaQ.rows[0] : null;

    // ==================================================================
    // PASO 5: Obtener dirección de entrega (etiqueta = 'casa') o fallback a cualquier dirección del cliente
    // ==================================================================
    let direccionEntrega: string | null = null;
    if (pedido.id_direccion) {
      const direccionByIdQ = await client.query(
        `SELECT * FROM public.direccion WHERE id_direccion = $1 LIMIT 1`,
        [pedido.id_direccion]
      );
      if (direccionByIdQ.rows.length > 0) {
        direccionEntrega = direccionByIdQ.rows[0].direccion || null;
      }
    }
    // Fallback: if venta had a direct direccion field use it
    if (!direccionEntrega && pedido.direccion)
      direccionEntrega = pedido.direccion;

    // ==================================================================
    // PASO 6: Crear Guía de Despacho automáticamente utilizando la OT creada
    // ==================================================================
    const guiaEstado =
      nuevaOT.estado !== "COMPLETADA" ? "EN PICKING" : "PENDIENTE";

    const guiaResult = await client.query(
      `
      INSERT INTO "Logistica".log_guia_despacho
        (id_ot, fecha, id_transportista, direccion_entrega, estado)
      VALUES ($1, NULL, $2, $3, $4)
      RETURNING *
    `,
      [
        nuevaOT.id_ot,
        transportistaAsignado ? transportistaAsignado.id_transportista : null,
        direccionEntrega,
        guiaEstado,
      ]
    );

    const nuevaGuia = guiaResult.rows[0];

    if (transportistaAsignado) {
      try {
        await client.query(
          `INSERT INTO "Logistica".empleado_counters (id_empleado, tipo, counter)
             VALUES ($1, 'TRANSPORTISTA', 1)
             ON CONFLICT (id_empleado) DO UPDATE
               SET counter = "Logistica".empleado_counters.counter + 1, updated_at = NOW()`,
          [transportistaAsignado.id_transportista]
        );
      } catch (err) {
        console.error(
          "Error incrementando empleado_counters para transportista",
          err
        );
      }
    }

    // ==================================================================
    // PASO 6: Actualizar estado en módulo de Ventas
    // ==================================================================

    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      message: "Pedido procesado automáticamente",
      data: {
        pedido: {
          id_venta,
          numero: numeroPedido,
          cliente: clienteCompleto,
          direccion: pedido.direccion,
        },
        orden_trabajo: {
          id_ot: nuevaOT.id_ot,
          empleado: `${empleadoInfo.nombre} ${empleadoInfo.apellido}`,
          fecha: nuevaOT.fecha,
          estado: nuevaOT.estado,
        },
        guia_despacho: {
          id_guia: nuevaGuia.id_guia,
          transportista: transportistaAsignado
            ? `${transportistaAsignado.nombre} ${transportistaAsignado.apellido}`
            : null,
          fecha: nuevaGuia.fecha,
          direccion: nuevaGuia.direccion_entrega,
        },
        notificacion_ventas: {
          pendiente: true,
          mensaje: 'Debe actualizar estado de venta a "Enviado" o "Completado"',
        },
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("\n❌ Error en procesamiento automático:", error);

    res.status(500).json({
      success: false,
      message: "Error al procesar pedido automáticamente",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  } finally {
    client.release();
  }
};

/**
 * GET /api/automatizacion/estadisticas-balanceo
 * Ver estadísticas de balanceo de carga
 */
export const obtenerEstadisticasBalanceo = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const empleados = await pool.query(`
      SELECT 
        e.id_empleado,
        e.nombre,
        e.apellido,
        e.rol,
        COUNT(ot.id_ot) as ot_pendientes
      FROM public.empleado e
      LEFT JOIN "Logistica".log_ot_picking ot 
        ON e.id_empleado = ot.id_empleado 
        AND ot.estado IN ('Pendiente', 'En proceso')
      WHERE e.rol = 'EMPLEADO'
      GROUP BY e.id_empleado, e.nombre, e.apellido, e.rol
      ORDER BY ot_pendientes ASC
    `);

    const transportistas = await pool.query(`
      SELECT 
        e.id_empleado as id_transportista,
        e.nombre,
        e.apellido,
        COUNT(gd.id_guia) as entregas_activas
      FROM public.empleado e
      LEFT JOIN "Logistica".log_guia_despacho gd 
        ON gd.id_transportista = e.id_empleado
      LEFT JOIN "Logistica".log_ot_picking ot 
        ON gd.id_ot = ot.id_ot
        AND ot.estado IN ('Pendiente', 'En proceso')
      WHERE e.rol = 'TRANSPORTISTA'
      GROUP BY e.id_empleado, e.nombre, e.apellido
      ORDER BY entregas_activas ASC
    `);

    res.json({
      success: true,
      data: {
        empleados: empleados.rows,
        transportistas: transportistas.rows,
      },
    });
  } catch (error) {
    console.error("Error al obtener estadísticas:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener estadísticas de balanceo",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

/**
 * PUT /api/automatizacion/ot/:id_ot
 * Edita una OT: permite cambiar el empleado asignado (id_empleado)
 * Body: { id_empleado: number }
 */
export const editarOt = async (req: Request, res: Response): Promise<void> => {
  const client = await pool.connect();
  try {
    const auth = (req as any).empleado;
    if (!auth) {
      res
        .status(401)
        .json({ success: false, message: "Token inválido o no autorizado" });
      return;
    }

    const allowedByRole: Record<string, string[]> = {
      JEFE_LOGISTICA: ["fecha", "id_empleado", "estado", "observaciones"],
      EMPLEADO_LOGISTICA: ["fecha", "estado", "observaciones"],
    };

    const processSingle = async (payload: any) => {
      const { id_ot } = payload;
      if (!id_ot) throw new Error("Falta id_ot en payload");

      const otQ = await client.query(
        `SELECT * FROM "Logistica".log_ot_picking WHERE id_ot = $1 FOR UPDATE`,
        [id_ot]
      );
      if (otQ.rows.length === 0) throw new Error(`OT ${id_ot} no encontrada`);
      const ot = otQ.rows[0];

      const allowed = allowedByRole[auth.rol] || [];

      const sets: string[] = [];
      const vals: any[] = [];
      let idx = 1;

      if (
        payload.hasOwnProperty("id_empleado") &&
        allowed.includes("id_empleado")
      ) {
        const newEmp = payload.id_empleado;
        if (newEmp !== ot.id_empleado) {
          const empQ = await client.query(
            `SELECT id_empleado, rol, estado FROM public.empleado WHERE id_empleado = $1 LIMIT 1`,
            [newEmp]
          );
          if (empQ.rows.length === 0) {
            throw new Error(`Empleado ${newEmp} no encontrado`);
          }
          const empRow = empQ.rows[0];
          const empRol = String(empRow.rol || "").toUpperCase();
          if (empRol !== "EMPLEADO_LOGISTICA") {
            throw new Error(
              `Empleado ${newEmp} no tiene rol EMPLEADO_LOGISTICA`
            );
          }

          sets.push(`id_empleado = $${idx++}`);
          vals.push(newEmp);
        }
      }

      if (payload.hasOwnProperty("fecha") && allowed.includes("fecha")) {
        const nuevaISO = parseAndNormalizeToISO(payload.fecha);
        const fechaActual = ot.fecha ? new Date(ot.fecha) : null;
        if (fechaActual) {
          // Permitimos hasta 1 día de desfase en la validación para evitar problemas de zona horaria
          const threshold = new Date(
            fechaActual.getTime() - 24 * 60 * 60 * 1000
          );
          if (new Date(nuevaISO) < threshold) {
            throw new Error(
              "La nueva fecha no puede ser anterior a la fecha registrada"
            );
          }
        }
        sets.push(`fecha = $${idx++}`);
        vals.push(nuevaISO);
      }
      if (payload.hasOwnProperty("estado") && allowed.includes("estado")) {
        sets.push(`estado = $${idx++}`);
        vals.push(payload.estado);
      }
      if (
        payload.hasOwnProperty("observaciones") &&
        allowed.includes("observaciones")
      ) {
        sets.push(`observaciones = $${idx++}`);
        vals.push(payload.observaciones);
      }

      if (sets.length > 0) {
        const q = `UPDATE "Logistica".log_ot_picking SET ${sets.join(
          ", "
        )} WHERE id_ot = $${idx}`;
        vals.push(id_ot);
        await client.query(q, vals);

        const incomingEstadoRaw = payload.hasOwnProperty("estado")
          ? String(payload.estado || "")
          : null;
        const incomingEstadoNorm = incomingEstadoRaw
          ? incomingEstadoRaw.toUpperCase().replace(/\s+/g, "_")
          : null;
        const otWasCompleted =
          String(ot.estado || "")
            .toUpperCase()
            .replace(/\s+/g, "_") === "COMPLETADA";
        if (incomingEstadoNorm === "COMPLETADA" && !otWasCompleted) {
          try {
            await client.query(
              `UPDATE "Logistica".log_guia_despacho SET estado = 'POR ASIGNAR', id_encargado = NULL, fecha = NULL WHERE id_ot = $1`,
              [id_ot]
            );
          } catch (err) {
            console.error("Error actualizando guías tras completar OT", err);
          }
        }
      }

      if (
        payload.hasOwnProperty("id_empleado") &&
        allowed.includes("id_empleado")
      ) {
        const newEmp = payload.id_empleado;
        if (newEmp !== ot.id_empleado) {
          try {
            if (ot.id_empleado) {
              await client.query(
                `UPDATE "Logistica".empleado_counters SET counter = GREATEST(counter - 1, 0), updated_at = NOW() WHERE id_empleado = $1`,
                [ot.id_empleado]
              );
            }
            await client.query(
              `INSERT INTO "Logistica".empleado_counters (id_empleado, tipo, counter) VALUES ($1, 'EMPLEADO_LOGISTICA', 1) ON CONFLICT (id_empleado) DO UPDATE SET counter = "Logistica".empleado_counters.counter + 1, updated_at = NOW()`,
              [newEmp]
            );
          } catch (err) {
            console.error(
              "Error actualizando empleado_counters en editarOt",
              err
            );
          }
        }
      }

      return { id_ot };
    };

    await client.query("BEGIN");

    if (Array.isArray((req.body as any).updates)) {
      const updates = (req.body as any).updates;
      const results: any[] = [];
      for (const u of updates) {
        const r = await processSingle(u);
        results.push(r);
      }
      await client.query("COMMIT");
      res.json({
        success: true,
        message: "Batch OT actualizadas",
        data: results,
      });
      return;
    }

    const singlePayload = { id_ot: req.params.id_ot, ...(req.body || {}) };
    const out = await processSingle(singlePayload);
    await client.query("COMMIT");
    res.json({ success: true, message: "OT actualizada", data: out });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (e) {}
    console.error("Error editarOt", error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Error al editar OT",
    });
  } finally {
    client.release();
  }
};

/**
 * PUT /api/automatizacion/guia/:id_guia
 * Edita una guía de despacho: transportista, fecha, direccion_entrega
 * Body: { transportista?: string, fecha?: string, direccion_entrega?: string }
 */
export const editarGuia = async (
  req: Request,
  res: Response
): Promise<void> => {
  const client = await pool.connect();
  try {
    const auth = (req as any).empleado;
    if (!auth) {
      res
        .status(401)
        .json({ success: false, message: "Token inválido o no autorizado" });
      return;
    }

    const allowedByRole: Record<string, string[]> = {
      JEFE_LOGISTICA: ["fecha", "id_transportista", "estado", "id_encargado"],
      TRANSPORTISTA: ["fecha", "estado", "id_encargado"],
    };

    const processSingle = async (payload: any) => {
      const { id_guia } = payload;
      if (!id_guia) throw new Error("Falta id_guia en payload");

      const guiaQ = await client.query(
        `SELECT * FROM "Logistica".log_guia_despacho WHERE id_guia = $1 FOR UPDATE`,
        [id_guia]
      );
      if (guiaQ.rows.length === 0)
        throw new Error(`Guía ${id_guia} no encontrada`);
      const guia = guiaQ.rows[0];

      const otQ = await client.query(
        `SELECT estado FROM "Logistica".log_ot_picking WHERE id_ot = $1 LIMIT 1`,
        [guia.id_ot]
      );
      const otEstado = otQ.rows.length > 0 ? otQ.rows[0].estado : null;
      const otEstadoNorm = String(otEstado || "")
        .toUpperCase()
        .replace(/\s+/g, "_");
      const otCompletada = otEstadoNorm === "COMPLETADA";

      const allowed = allowedByRole[auth.rol] || [];

      const sendValidationError = async (
        status: number,
        code: string,
        message: string
      ) => {
        try {
          await client.query("ROLLBACK");
        } catch (e) {}
        console.log(
          `editarGuia - validation error [id_guia=${payload.id_guia}] ${code}: ${message}`
        );
        res.status(status).json({ success: false, code, message });
        const e: any = new Error("STOP_PROCESSING");
        e.stop = true;
        throw e;
      };

      if (!otCompletada) {
        const editFields = [
          "id_transportista",
          "fecha",
          "estado",
          "id_encargado",
        ];
        const payloadHasEdit = editFields.some((f) =>
          payload.hasOwnProperty(f)
        );
        if (payloadHasEdit) {
          await sendValidationError(
            403,
            "OT_NOT_COMPLETED",
            "La OT asociada no está completada; la guía sólo puede estar en EN_PICKING y no puede editarse"
          );
        }
      }

      if (
        payload.hasOwnProperty("id_encargado") &&
        auth.rol === "TRANSPORTISTA"
      ) {
        const idEnc = payload.id_encargado;

        const encQ = await client.query(
          `SELECT id_empleado_transportista AS id_transportista, id_empresa FROM "Logistica".log_transportistas WHERE id_empleado_transportista = $1 LIMIT 1`,
          [idEnc]
        );
        if (encQ.rows.length === 0) throw new Error("Encargado inválido");
        const encRow = encQ.rows[0];

        const guiaEmpresaId = Number(guia.id_transportista);
        const guiaEmpresa = Number.isNaN(guiaEmpresaId) ? null : guiaEmpresaId;

        if (guiaEmpresa && encRow.id_empresa !== guiaEmpresa) {
          const myT = await client.query(
            `SELECT id_empleado_transportista AS id_transportista, id_empresa FROM "Logistica".log_transportistas WHERE id_empleado_transportista = $1 LIMIT 1`,
            [auth.id_empleado]
          );
          if (
            myT.rows.length === 0 ||
            myT.rows[0].id_empresa !== encRow.id_empresa
          ) {
            throw new Error(
              "No permitido: encargado no pertenece a la empresa asignada a la guía"
            );
          }
        }
      }

      const sets: string[] = [];
      const vals: any[] = [];
      let idx = 1;

      const currentEstadoNorm = String(guia.estado || "")
        .toUpperCase()
        .replace(/\s+/g, "_");
      const incomingEstadoRaw = payload.hasOwnProperty("estado")
        ? String(payload.estado || "")
        : null;
      const incomingEstadoNorm = incomingEstadoRaw
        ? incomingEstadoRaw.toUpperCase().replace(/\s+/g, "_")
        : null;

      const isCurrentlyEntregada = currentEstadoNorm === "ENTREGADA";
      if (isCurrentlyEntregada) {
        if (payload.hasOwnProperty("estado")) {
          await sendValidationError(
            403,
            "ALREADY_DELIVERED",
            "No se puede cambiar el estado de una guía ENTREGADA"
          );
        }
        if (payload.hasOwnProperty("id_transportista")) {
          await sendValidationError(
            403,
            "ALREADY_DELIVERED",
            "No se puede cambiar el transportista de una guía ENTREGADA"
          );
        }
        if (payload.hasOwnProperty("id_encargado")) {
          await sendValidationError(
            403,
            "ALREADY_DELIVERED",
            "No se puede cambiar el encargado de una guía ENTREGADA"
          );
        }
      }

      if (
        incomingEstadoNorm === "EN_PICKING" &&
        currentEstadoNorm !== "EN_PICKING"
      ) {
        await sendValidationError(
          400,
          "INVALID_TRANSITION",
          "No se puede volver al estado EN_PICKING una vez que la guía avanzó"
        );
      }

      const incomingIdEncargado = payload.hasOwnProperty("id_encargado")
        ? payload.id_encargado
        : null;

      if (
        payload.hasOwnProperty("id_encargado") &&
        (payload.id_encargado === null || payload.id_encargado === "")
      ) {
        payload.estado = "POR ASIGNAR";
      }

      const wantsToBeAsignada = incomingEstadoNorm === "ASIGNADA";
      const currentlyEnPicking =
        currentEstadoNorm === "EN_PICKING" ||
        currentEstadoNorm === "ENPICKING" ||
        (otCompletada && currentEstadoNorm === "POR_ASIGNAR");

      let willAutoSetEstadoToAsignada = false;
      if (incomingIdEncargado && !wantsToBeAsignada && currentlyEnPicking) {
        payload.estado = "ASIGNADA";
        willAutoSetEstadoToAsignada = true;
      }

      if (wantsToBeAsignada && currentlyEnPicking) {
        const hasExistingEncargado =
          guia.id_encargado !== null && guia.id_encargado !== undefined;
        const providedEncargado =
          incomingIdEncargado !== null && incomingIdEncargado !== undefined;
        if (!hasExistingEncargado && !providedEncargado) {
          await sendValidationError(
            400,
            "MISSING_ENCARGADO",
            "Para cambiar a ASIGNADA se requiere un encargado"
          );
        }
      }

      const estadoWillChange =
        (incomingEstadoNorm && incomingEstadoNorm !== currentEstadoNorm) ||
        willAutoSetEstadoToAsignada;
      const nowISO = new Date().toISOString();

      if (
        payload.hasOwnProperty("id_transportista") &&
        allowed.includes("id_transportista")
      ) {
        sets.push(`id_transportista = $${idx++}`);
        vals.push(payload.id_transportista);
      }

      if (estadoWillChange) {
        if (!allowed.includes("fecha") && payload.hasOwnProperty("fecha")) {
          await sendValidationError(
            403,
            "FORBIDDEN_FECHA",
            "No autorizado a cambiar fecha junto al estado"
          );
        }
        sets.push(`fecha = $${idx++}`);
        vals.push(nowISO);

        if (payload.hasOwnProperty("estado") || willAutoSetEstadoToAsignada) {
          sets.push(`estado = $${idx++}`);
          vals.push(payload.estado);
        }
      } else {
        if (payload.hasOwnProperty("fecha") && allowed.includes("fecha")) {
          sets.push(`fecha = $${idx++}`);
          vals.push(parseAndNormalizeToISO(payload.fecha));
        }
        if (payload.hasOwnProperty("estado") && allowed.includes("estado")) {
          sets.push(`estado = $${idx++}`);
          vals.push(payload.estado);
        }
      }
      if (
        payload.hasOwnProperty("id_encargado") &&
        allowed.includes("id_encargado")
      ) {
        sets.push(`id_encargado = $${idx++}`);
        vals.push(payload.id_encargado);
      }

      if (sets.length > 0) {
        const q = `UPDATE "Logistica".log_guia_despacho SET ${sets.join(
          ", "
        )} WHERE id_guia = $${idx}`;
        vals.push(id_guia);
        await client.query(q, vals);
      }

      if (payload.hasOwnProperty("id_encargado")) {
        try {
          const oldEncQ = await client.query(
            `SELECT id_empleado_transportista FROM "Logistica".log_transportistas WHERE id_empleado_transportista = $1 LIMIT 1`,
            [guia.id_encargado]
          );
          const newEncQ = await client.query(
            `SELECT id_empleado_transportista FROM "Logistica".log_transportistas WHERE id_empleado_transportista = $1 LIMIT 1`,
            [payload.id_encargado]
          );
          if (oldEncQ.rows.length > 0) {
            await client.query(
              `UPDATE "Logistica".empleado_counters SET counter = GREATEST(counter - 1, 0), updated_at = NOW() WHERE id_empleado = $1`,
              [oldEncQ.rows[0].id_empleado_transportista]
            );
          }
          if (newEncQ.rows.length > 0) {
            await client.query(
              `INSERT INTO "Logistica".empleado_counters (id_empleado, tipo, counter) VALUES ($1, 'TRANSPORTISTA', 1) ON CONFLICT (id_empleado) DO UPDATE SET counter = "Logistica".empleado_counters.counter + 1, updated_at = NOW()`,
              [newEncQ.rows[0].id_empleado_transportista]
            );
          }
        } catch (err) {
          console.log(
            `editarGuia - error actualizando empleado_counters [id_guia=${id_guia}]:`,
            err
          );
          console.error(
            "Error actualizando empleado_counters en editarGuia",
            err
          );
        }
      }

      return { id_guia };
    };

    await client.query("BEGIN");
    if (Array.isArray((req.body as any).updates)) {
      const updates = (req.body as any).updates;
      const results: any[] = [];
      for (const u of updates) {
        const r = await processSingle(u);
        results.push(r);
      }
      await client.query("COMMIT");
      res.json({
        success: true,
        message: "Batch guías actualizadas",
        data: results,
      });
      return;
    }

    const singlePayload = { id_guia: req.params.id_guia, ...(req.body || {}) };
    const out = await processSingle(singlePayload);
    await client.query("COMMIT");
    res.json({ success: true, message: "Guía actualizada", data: out });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (e) {}
    if ((error as any)?.stop || (error as any)?.message === "STOP_PROCESSING")
      return;
    console.log("editarGuia - captured error:", error);
    console.error("Error editarGuia", error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Error al editar guía",
    });
  } finally {
    client.release();
  }
};
