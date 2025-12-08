import { Router } from "express";
import {
  listarEmpleados,
  listarEmpleadosTransportistas,
  listarTransportistas,
} from "../controllers/recursos.controller";
import authMiddleware from "../middleware/auth.middleware";

const router = Router();

router.use(authMiddleware);

/**
 * @route GET /api/recursos/empleados
 * @desc Lista todos los empleados activos
 */
router.get("/empleados", listarEmpleados);

/**
 * @route GET /api/recursos/transportistas
 * @desc Lista todos los transportistas activos
 */
router.get("/transportistas", listarTransportistas);

/**
 * @route GET /api/recursos/empleados-transportistas
 * @desc Lista todos los empleados y transportistas activos
 */
router.get("/empleados-transportistas", listarEmpleadosTransportistas);

export default router;
