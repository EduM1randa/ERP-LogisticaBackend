import { Request, Response } from "express";
import pool from "../config/database";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "change_this_secret";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

/**
 * POST /auth/login
 * body: { email, password }
 * Returns: 201 { empleado, access_token } on success
 */
export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Faltan credenciales" });
  }

  try {
    const empQ = `
      SELECT id_empleado as id, nombre, apellido, email, rol, id_departamento, rut
      FROM public.empleado
      WHERE email = $1
    `;
    const empRes = await pool.query(empQ, [email]);
    if ((empRes.rowCount ?? 0) === 0) {
      return res.status(401).json({ message: "Credenciales incorrectas" });
    }

    const empleadoRow = empRes.rows[0];

    // Obtener roles asociados (si existen) desde esquema RRHH
    const rolesQ = `
      SELECT r.nombre
      FROM "RRHH".rrhh_empleado_rol er
      JOIN "RRHH".rrhh_rol r ON er.id_rol = r.id_rol
      WHERE er.id_empleado = $1
    `;
    const rolesRes = await pool.query(rolesQ, [empleadoRow.id]);
    const roles: string[] = rolesRes.rows.map((r: any) => r.nombre);

    // Buscar usuario en RRHH.rrhh_usuario por id_empleado
    const userQ = `SELECT id_usuario, id_empleado, password_hash, activo FROM "RRHH".rrhh_usuario WHERE id_empleado = $1`;
    const userRes = await pool.query(userQ, [empleadoRow.id]);
    if ((userRes.rowCount ?? 0) === 0) {
      return res.status(401).json({ message: "Usuario inactivo o no existe" });
    }

    const usuario = userRes.rows[0];
    if (!usuario.activo) {
      return res.status(401).json({ message: "Usuario inactivo o no existe" });
    }

    const passwordValid = await bcrypt.compare(password, usuario.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ message: "Credenciales incorrectas" });
    }

    // Generar token JWT
    const payload = {
      sub: empleadoRow.id,
      email: empleadoRow.email,
      roles,
    };

    const token = jwt.sign(
      payload as object,
      JWT_SECRET as unknown as jwt.Secret,
      { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
    );

    return res.status(201).json({
      access_token: token,
      empleado: {
        id: empleadoRow.id,
        nombre: empleadoRow.nombre,
        apellido: empleadoRow.apellido,
        email: empleadoRow.email,
        rol: empleadoRow.rol,
        roles,
        id_departamento: empleadoRow.id_departamento,
      },
    });
  } catch (error) {
    console.error("Error auth.login", error);
    return res.status(500).json({ message: "Error interno en autenticación" });
  }
};

/**
 * POST /auth/register
 * body: { email, rut, password }
 */
export const register = async (req: Request, res: Response) => {
  const { email, rut, password } = req.body;
  if (!email || !rut || !password) {
    return res.status(400).json({ message: "Faltan datos obligatorios" });
  }

  try {
    const empQ = `
      SELECT id_empleado as id, nombre, apellido, email, rut
      FROM public.empleado
      WHERE email = $1 OR rut = $2
    `;
    const empRes = await pool.query(empQ, [email, rut]);

    if ((empRes.rowCount ?? 0) === 0) {
      return res.status(400).json({
        message: "No se encontró un empleado con los datos proporcionados",
      });
    }

    const empleado = empRes.rows[0];

    const existQ = `SELECT id_empleado FROM "RRHH".rrhh_usuario WHERE id_empleado = $1`;
    const existRes = await pool.query(existQ, [empleado.id]);
    if ((existRes.rowCount ?? 0) > 0) {
      return res
        .status(400)
        .json({ message: "Este empleado ya tiene un usuario registrado" });
    }

    if (empleado.email !== email || empleado.rut !== rut) {
      return res.status(400).json({
        message:
          "Los datos proporcionados no coinciden con el empleado existente",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const insertQ = `
      INSERT INTO "RRHH".rrhh_usuario (id_empleado, password_hash, activo)
      VALUES ($1, $2, true)
    `;
    await pool.query(insertQ, [empleado.id, hashedPassword]);

    const rolesQ = `SELECT r.id_rol, r.nombre FROM "RRHH".rrhh_empleado_rol er 
        JOIN "RRHH".rrhh_rol r ON er.id_rol = r.id_rol WHERE er.id_empleado = $1`;
    const rolesRes = await pool.query(rolesQ, [empleado.id]);

    if ((rolesRes.rowCount ?? 0) === 0) {
      const rolQ = `SELECT id_rol FROM "RRHH".rrhh_rol WHERE nombre = 'EMPLEADO' LIMIT 1`;
      const rolRes = await pool.query(rolQ);
      if ((rolRes.rowCount ?? 0) === 0) {
        return res
          .status(400)
          .json({ message: "No se encontró el rol EMPLEADO en el sistema" });
      }
      const idRol = rolRes.rows[0].id_rol;
      const assignQ = `INSERT INTO rrhh_empleado_rol (id_empleado, id_rol) VALUES ($1, $2)`;
      await pool.query(assignQ, [empleado.id, idRol]);
    }

    return res.status(201).json({
      message: "Usuario registrado exitosamente",
      empleado: {
        id: empleado.id,
        nombre: empleado.nombre,
        email: empleado.email,
      },
    });
  } catch (error) {
    console.error("Error auth.register", error);
    return res
      .status(500)
      .json({ message: "Error interno al registrar usuario" });
  }
};
