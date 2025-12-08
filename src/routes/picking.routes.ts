import { Router } from "express";
import {
  getAllOrdenesPicking,
  getOrdenPickingById,
  generarPdfPicking,
  createOrdenPicking,
  updateOrdenPicking,
  getMisOrdenesPicking,
} from "../controllers/picking.controller.js";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.use(authMiddleware);

/**
 * @route   GET /api/picking
 * @desc    Obtener todas las órdenes de picking
 */
router.get("/", getAllOrdenesPicking);

/**
 * @route   GET /api/picking/:id/pdf
 * @desc    Descargar PDF de una OT
 */
router.get("/mis", getMisOrdenesPicking);

/**
 * @route   GET /api/picking/:id/pdf
 * @desc    Descargar PDF de una OT
 */
router.get("/:id/pdf", generarPdfPicking);

/**
 * @route   GET /api/picking/:id
 * @desc    Obtener una orden de picking específica
 */
router.get("/:id", getOrdenPickingById);

/**
 * @route   POST /api/picking
 * @desc    Crear nueva orden de picking
 */
router.post("/", createOrdenPicking);

/**
 * @route   PUT /api/picking/:id
 * @desc    Actualizar orden de picking
 */
router.put("/:id", updateOrdenPicking);

export default router;
