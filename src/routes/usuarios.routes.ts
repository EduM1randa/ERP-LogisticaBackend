import { Router } from "express";
import { listarEmpleadosLogistica } from "../controllers/usuarios.controller";

const router = Router();

router.get("/empleados-logistica", listarEmpleadosLogistica);

export default router;
