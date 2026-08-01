const bcrypt = require('bcrypt');
const express = require('express');

const pool = require('../db');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { failure, success } = require('../response');

const router = express.Router();

// 用户路由放在这里
router.get(
  '/users',
  authenticate,
  authorize('user:list'),
  async (req, res, next) => {
    try {
      const userResult = await pool.query(`
      SELECT
        u.id,
        u.username,
        u.real_name,
        u.email,
        u.is_active,
        u.last_login_at,
        u.created_at,
        COALESCE(
          array_agg(DISTINCT r.code ORDER BY r.code)
            FILTER (WHERE r.code IS NOT NULL),
          ARRAY[]::varchar[]
        ) AS roles
      FROM users AS u
      LEFT JOIN user_roles AS ur
        ON ur.user_id = u.id
      LEFT JOIN roles AS r
        ON r.id = ur.role_id
      GROUP BY u.id
      ORDER BY u.id
    `);

      const users = userResult.rows.map((user) => ({
        id: user.id,
        username: user.username,
        realName: user.real_name,
        email: user.email,
        isActive: user.is_active,
        roles: user.roles,
        lastLoginAt: user.last_login_at,
        createdAt: user.created_at,
      }));

      return success(res, users);
    } catch (error) {
      return next(error);
    }
  });

router.get(
  '/users/page',
  authenticate,
  authorize('user:list'),
  async (req, res, next) => {
    try {
      const parsedPage = Number.parseInt(String(req.query.page ?? '1'), 10);
      const parsedPageSize = Number.parseInt(
        String(req.query.pageSize ?? '10'),
        10,
      );

      const page = Number.isNaN(parsedPage)
        ? 1
        : Math.max(parsedPage, 1);

      const pageSize = Number.isNaN(parsedPageSize)
        ? 10
        : Math.min(Math.max(parsedPageSize, 1), 100);

      const keyword =
        typeof req.query.keyword === 'string'
          ? req.query.keyword.trim()
          : '';

      const offset = (page - 1) * pageSize;

      const whereSql = `
      WHERE (
        $1 = ''
        OR u.username ILIKE '%' || $1 || '%'
        OR u.real_name ILIKE '%' || $1 || '%'
        OR COALESCE(u.email, '') ILIKE '%' || $1 || '%'
      )
    `;

      const [countResult, userResult] = await Promise.all([
        pool.query(
          `
          SELECT COUNT(*)::integer AS total
          FROM users AS u
          ${whereSql}
        `,
          [keyword],
        ),
        pool.query(
          `
          SELECT
            u.id,
            u.username,
            u.real_name,
            u.email,
            u.is_active,
            u.last_login_at,
            u.created_at,
            COALESCE(
              array_agg(DISTINCT r.code ORDER BY r.code)
                FILTER (WHERE r.code IS NOT NULL),
              ARRAY[]::varchar[]
            ) AS roles
          FROM users AS u
          LEFT JOIN user_roles AS ur
            ON ur.user_id = u.id
          LEFT JOIN roles AS r
            ON r.id = ur.role_id
          ${whereSql}
          GROUP BY u.id
          ORDER BY u.id
          LIMIT $2
          OFFSET $3
        `,
          [keyword, pageSize, offset],
        ),
      ]);

      const items = userResult.rows.map((user) => ({
        id: user.id,
        username: user.username,
        realName: user.real_name,
        email: user.email,
        isActive: user.is_active,
        roles: user.roles,
        lastLoginAt: user.last_login_at,
        createdAt: user.created_at,
      }));

      return success(res, {
        items,
        total: countResult.rows[0].total,
        page,
        pageSize,
      });
    } catch (error) {
      return next(error);
    }
  });

router.get(
  '/roles/options',
  authenticate,
  authorize('user:create'),
  async (req, res, next) => {
    try {
      const roleResult = await pool.query(`
        SELECT code, name
        FROM roles
        WHERE is_active = TRUE
        ORDER BY id
      `);

      const roles = roleResult.rows.map((role) => ({
        code: role.code,
        name: role.name,
      }));

      return success(res, roles);
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  '/users',
  authenticate,
  authorize('user:create'),
  async (req, res, next) => {
    const {
      username,
      password,
      realName,
      email,
      roleCodes,
    } = req.body ?? {};

    if (
      typeof username !== 'string' ||
      username.trim() === '' ||
      typeof realName !== 'string' ||
      realName.trim() === ''
    ) {
      return failure(res, 400, '用户名和姓名不能为空');
    }

    if (typeof password !== 'string' || password.length < 8) {
      return failure(res, 400, '密码不能少于 8 个字符');
    }

    if (!Array.isArray(roleCodes) || roleCodes.length === 0) {
      return failure(res, 400, '请至少选择一个角色');
    }

    const normalizedEmail =
      typeof email === 'string' && email.trim() !== ''
        ? email.trim()
        : null;

    if (
      normalizedEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
    ) {
      return failure(res, 400, '邮箱格式不正确');
    }

    const normalizedRoleCodes = [
      ...new Set(
        roleCodes
          .filter((roleCode) => typeof roleCode === 'string')
          .map((roleCode) => roleCode.trim())
          .filter(Boolean),
      ),
    ];

    if (normalizedRoleCodes.length === 0) {
      return failure(res, 400, '请至少选择一个有效角色');
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const roleResult = await client.query(
        `
          SELECT id, code
          FROM roles
          WHERE code = ANY($1::varchar[])
            AND is_active = TRUE
        `,
        [normalizedRoleCodes],
      );

      if (roleResult.rowCount !== normalizedRoleCodes.length) {
        await client.query('ROLLBACK');
        return failure(res, 400, '包含不存在或已禁用的角色');
      }

      const passwordHash = await bcrypt.hash(password, 12);

      const userResult = await client.query(
        `
          INSERT INTO users (
            username,
            password_hash,
            real_name,
            email
          )
          VALUES ($1, $2, $3, $4)
          RETURNING
            id,
            username,
            real_name,
            email,
            is_active,
            created_at
        `,
        [
          username.trim(),
          passwordHash,
          realName.trim(),
          normalizedEmail,
        ],
      );

      const user = userResult.rows[0];

      await client.query(
        `
          INSERT INTO user_roles (user_id, role_id)
          SELECT $1, id
          FROM roles
          WHERE code = ANY($2::varchar[])
        `,
        [user.id, normalizedRoleCodes],
      );

      await client.query('COMMIT');

      res.status(201);

      return success(
        res,
        {
          id: user.id,
          username: user.username,
          realName: user.real_name,
          email: user.email,
          isActive: user.is_active,
          roles: normalizedRoleCodes,
          createdAt: user.created_at,
        },
        '用户创建成功',
      );
    } catch (error) {
      await client.query('ROLLBACK');

      if (error.code === '23505') {
        return failure(res, 409, '用户名或邮箱已存在');
      }

      return next(error);
    } finally {
      client.release();
    }
  },
);

router.put(
  '/users/:id',
  authenticate,
  authorize('user:update'),
  async (req, res, next) => {
    const userId = String(req.params.id);

    if (!/^\d+$/.test(userId)) {
      return failure(res, 400, '用户 ID 格式不正确');
    }

    if (userId === String(req.auth.userId)) {
      return failure(res, 400, '不能通过用户管理修改当前登录账号');
    }

    const {
      realName,
      email,
      roleCodes,
    } = req.body ?? {};

    if (typeof realName !== 'string' || realName.trim() === '') {
      return failure(res, 400, '姓名不能为空');
    }

    if (!Array.isArray(roleCodes) || roleCodes.length === 0) {
      return failure(res, 400, '请至少选择一个角色');
    }

    const normalizedEmail =
      typeof email === 'string' && email.trim() !== ''
        ? email.trim()
        : null;

    if (
      normalizedEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
    ) {
      return failure(res, 400, '邮箱格式不正确');
    }

    const normalizedRoleCodes = [
      ...new Set(
        roleCodes
          .filter((roleCode) => typeof roleCode === 'string')
          .map((roleCode) => roleCode.trim())
          .filter(Boolean),
      ),
    ];

    if (normalizedRoleCodes.length === 0) {
      return failure(res, 400, '请至少选择一个有效角色');
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      await client.query(
        'SELECT pg_advisory_xact_lock($1)',
        [730001],
      );
      const roleResult = await client.query(
        `
          SELECT id, code
          FROM roles
          WHERE code = ANY($1::varchar[])
            AND is_active = TRUE
        `,
        [normalizedRoleCodes],
      );

      if (roleResult.rowCount !== normalizedRoleCodes.length) {
        await client.query('ROLLBACK');
        return failure(res, 400, '包含不存在或已禁用的角色');
      }

      const removesSuperAdmin =
        !normalizedRoleCodes.includes('super_admin');

      if (removesSuperAdmin) {
        const currentSuperAdminResult = await client.query(
          `
      SELECT 1
      FROM users AS u
      JOIN user_roles AS ur
        ON ur.user_id = u.id
      JOIN roles AS r
        ON r.id = ur.role_id
      WHERE u.id = $1
        AND u.is_active = TRUE
        AND r.is_active = TRUE
        AND r.code = 'super_admin'
      LIMIT 1
    `,
          [userId],
        );

        if (currentSuperAdminResult.rowCount > 0) {
          const activeSuperAdminResult = await client.query(`
      SELECT COUNT(DISTINCT u.id)::integer AS total
      FROM users AS u
      JOIN user_roles AS ur
        ON ur.user_id = u.id
      JOIN roles AS r
        ON r.id = ur.role_id
      WHERE u.is_active = TRUE
        AND r.is_active = TRUE
        AND r.code = 'super_admin'
    `);

          if (activeSuperAdminResult.rows[0].total <= 1) {
            await client.query('ROLLBACK');

            return failure(
              res,
              400,
              '不能移除系统中最后一个启用的超级管理员角色',
            );
          }
        }
      }

      const userResult = await client.query(
        `
          UPDATE users
          SET
            real_name = $1,
            email = $2
          WHERE id = $3
          RETURNING
            id,
            username,
            real_name,
            email,
            is_active,
            last_login_at,
            created_at
        `,
        [
          realName.trim(),
          normalizedEmail,
          userId,
        ],
      );

      if (userResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return failure(res, 404, '用户不存在');
      }

      await client.query(
        'DELETE FROM user_roles WHERE user_id = $1',
        [userId],
      );

      await client.query(
        `
          INSERT INTO user_roles (user_id, role_id)
          SELECT $1, id
          FROM roles
          WHERE code = ANY($2::varchar[])
        `,
        [userId, normalizedRoleCodes],
      );

      await client.query('COMMIT');

      const user = userResult.rows[0];

      return success(
        res,
        {
          id: user.id,
          username: user.username,
          realName: user.real_name,
          email: user.email,
          isActive: user.is_active,
          roles: normalizedRoleCodes,
          lastLoginAt: user.last_login_at,
          createdAt: user.created_at,
        },
        '用户修改成功',
      );
    } catch (error) {
      await client.query('ROLLBACK');

      if (error.code === '23505') {
        return failure(res, 409, '邮箱已被其他用户使用');
      }

      return next(error);
    } finally {
      client.release();
    }
  },
);

router.patch(
  '/users/:id/status',
  authenticate,
  authorize('user:update'),
  async (req, res, next) => {
    const userId = String(req.params.id);
    const { isActive } = req.body ?? {};

    if (!/^\d+$/.test(userId)) {
      return failure(res, 400, '用户 ID 格式不正确');
    }

    if (typeof isActive !== 'boolean') {
      return failure(res, 400, '用户状态必须是布尔值');
    }

    if (userId === String(req.auth.userId)) {
      return failure(res, 400, '不能禁用或启用当前登录账号');
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      await client.query(
        'SELECT pg_advisory_xact_lock($1)',
        [730001],
      );

      const userResult = await client.query(
        `
          SELECT id, username, is_active
          FROM users
          WHERE id = $1
          FOR UPDATE
        `,
        [userId],
      );

      if (userResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return failure(res, 404, '用户不存在');
      }

      const user = userResult.rows[0];

      if (user.is_active === isActive) {
        await client.query('COMMIT');

        return success(res, {
          id: user.id,
          username: user.username,
          isActive: user.is_active,
        });
      }

      if (!isActive) {
        const superAdminResult = await client.query(
          `
            SELECT 1
            FROM user_roles AS ur
            JOIN roles AS r
              ON r.id = ur.role_id
            WHERE ur.user_id = $1
              AND r.code = 'super_admin'
            LIMIT 1
          `,
          [userId],
        );

        if (superAdminResult.rowCount > 0) {
          const activeSuperAdminResult = await client.query(`
            SELECT COUNT(DISTINCT u.id)::integer AS total
            FROM users AS u
            JOIN user_roles AS ur
              ON ur.user_id = u.id
            JOIN roles AS r
              ON r.id = ur.role_id
            WHERE u.is_active = TRUE
              AND r.is_active = TRUE
              AND r.code = 'super_admin'
          `);

          if (activeSuperAdminResult.rows[0].total <= 1) {
            await client.query('ROLLBACK');
            return failure(
              res,
              400,
              '不能禁用系统中最后一个启用的超级管理员',
            );
          }
        }
      }

      const updatedResult = await client.query(
        `
          UPDATE users
          SET is_active = $1
          WHERE id = $2
          RETURNING id, username, is_active
        `,
        [isActive, userId],
      );

      await client.query('COMMIT');

      const updatedUser = updatedResult.rows[0];

      return success(
        res,
        {
          id: updatedUser.id,
          username: updatedUser.username,
          isActive: updatedUser.is_active,
        },
        isActive ? '用户已启用' : '用户已禁用',
      );
    } catch (error) {
      await client.query('ROLLBACK');
      return next(error);
    } finally {
      client.release();
    }
  },
);




module.exports = router;