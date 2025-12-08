import { Router } from "express";
import {
  procesarPedidoAutomatico,
  obtenerEstadisticasBalanceo,
  editarOt,
  editarGuia,
} from "../controllers/automatizacion.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.use(authMiddleware);

/**
 * @route POST /api/automatizacion/procesar-pedido
 * @desc Procesa un pedido de venta automáticamente
 */
router.post("/procesar-pedido", procesarPedidoAutomatico);

/**
 * @route GET /api/automatizacion/estadisticas-balanceo
 * @desc Obtiene estadísticas de balanceo de carga de empleados y transportistas
 */
router.get("/estadisticas-balanceo", obtenerEstadisticasBalanceo);

/**
 * @route PUT /api/automatizacion/ot/:id_ot
 * @desc Edita una orden de trabajo (OT) existente
 */

router.put("/ot/:id_ot", editarOt);
/**
 * @route PUT /api/automatizacion/guia/:id_guia
 * @desc Edita una guía existente
 */
router.put("/guia/:id_guia", editarGuia);

export default router;
