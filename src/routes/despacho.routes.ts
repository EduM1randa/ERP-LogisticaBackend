import { Router } from "express";
import {
  getAllGuiasDespacho,
  getGuiaDespachoById,
  generarPdfGuia,
  createGuiaDespacho,
  getMisGuiasDespacho,
  getTransportistasByEmpresa,
} from "../controllers/despacho.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.use(authMiddleware);

/**
 * @route   GET /api/despacho
 * @desc    Obtener todas las guías de despacho
 */
router.get("/", getAllGuiasDespacho);

/**
 * @route   GET /api/despacho/mis
 * @desc    Obtener guías de despacho asignadas al usuario autenticado
 */
router.get("/mis", getMisGuiasDespacho);

/**
 * @route   GET /api/despacho/transportistas/:id_empresa
 * @desc    Obtener transportistas asociados a una empresa específica
 */
router.get("/transportistas/:id_empresa", getTransportistasByEmpresa);

/**
 * @route   GET /api/despacho/:id/pdf
 * @desc    Generar PDF de una guía de despacho específica
 */
router.get("/:id/pdf", generarPdfGuia);

/**
 * @route   GET /api/despacho/:id
 * @desc    Obtener una guía de despacho específica
 */
router.get("/:id", getGuiaDespachoById);

/**
 * @route   POST /api/despacho
 * @desc    Crear nueva guía de despacho
 */
router.post("/", createGuiaDespacho);

export default router;
