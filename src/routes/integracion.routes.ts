import { Router } from "express";
import {
  listarPedidosVentas,
  obtenerPedidoVenta,
  recibirPedidoVenta,
  listarOrdenesCompra,
  recibirRecepcion,
} from "../controllers/integracion.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.use(authMiddleware);

// ==================== PEDIDOS DE VENTAS ====================

/**
 * @route GET /api/integracion/pedidos-ventas
 * @desc Lista todos los pedidos de ventas desde el sistema externo
 */
router.get("/pedidos-ventas", listarPedidosVentas);

/**
 * @route GET /api/integracion/pedidos-ventas/:id
 * @desc Obtiene un pedido de venta específico desde el sistema externo
 */
router.get("/pedidos-ventas/:id", obtenerPedidoVenta);

/**
 * @route POST /api/integracion/recibir-pedido-venta
 * @desc Recibe un nuevo pedido de venta desde el sistema externo
 */
router.post("/recibir-pedido-venta", recibirPedidoVenta);

// ==================== ÓRDENES DE COMPRA ====================

/**
 * @route GET /api/integracion/ordenes-compra
 * @desc Lista todas las órdenes de compra desde el sistema externo
 */
router.get("/ordenes-compra", listarOrdenesCompra);

/**
 * @route PUT /api/integracion/recepciones/:id/recibir
 * @desc Marca una recepción de orden de compra como recibida en el sistema externo
 */
router.put("/recepciones/:id/recibir", authMiddleware, recibirRecepcion);

export default router;
