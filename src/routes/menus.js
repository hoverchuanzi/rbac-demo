const express = require('express');

const pool = require('../db');
const authenticate = require('../middleware/authenticate');
const { success } = require('../response');

const router = express.Router();

// 菜单树函数和菜单接口放在这里
function buildMenuTree(rows) {
  const menusById = new Map();

  for (const row of rows) {
    const extraMeta =
      row.extra_meta &&
        typeof row.extra_meta === 'object' &&
        !Array.isArray(row.extra_meta)
        ? row.extra_meta
        : {};
    const meta = {
      ...extraMeta,
      title: row.title,
      order: row.sort_order,
      hideInMenu: row.is_hidden,
      keepAlive: row.keep_alive,
    };

    if (row.icon) {
      meta.icon = row.icon;
    }

    const menu = {
      name: row.name,
      path: row.path,
      meta,
    };

    if (row.component) {
      menu.component = row.component;
    }

    if (row.redirect) {
      menu.redirect = row.redirect;
    }

    menusById.set(String(row.id), {
      menu,
      parentId: row.parent_id === null ? null : String(row.parent_id),
    });
  }

  const roots = [];

  for (const entry of menusById.values()) {
    if (entry.parentId === null) {
      roots.push(entry.menu);
      continue;
    }

    const parent = menusById.get(entry.parentId);

    // A child without an accessible parent cannot form a valid menu route.
    if (!parent) {
      continue;
    }

    parent.menu.children ??= [];
    parent.menu.children.push(entry.menu);
  }

  return roots;
}

router.get('/menu/all', authenticate, async (req, res, next) => {
  try {
    const userResult = await pool.query(
      'SELECT 1 FROM users WHERE id = $1 AND is_active = TRUE',
      [req.auth.userId],
    );

    if (userResult.rowCount === 0) {
      return failure(res, 401, '用户不存在或已被禁用');
    }

    const menuResult = await pool.query(
      `
        SELECT
          m.id,
          m.parent_id,
          m.name,
          m.path,
          m.component,
          m.redirect,
          m.title,
          m.icon,
          m.sort_order,
          m.is_hidden,
          m.keep_alive,
          m.extra_meta
        FROM menus m
        WHERE m.is_active = TRUE
          AND EXISTS (
            SELECT 1
            FROM user_roles ur
            JOIN roles r
              ON r.id = ur.role_id
             AND r.is_active = TRUE
            JOIN role_menus rm
              ON rm.role_id = r.id
             AND rm.menu_id = m.id
            WHERE ur.user_id = $1
          )
        ORDER BY m.sort_order, m.id
      `,
      [req.auth.userId],
    );

    return success(res, buildMenuTree(menuResult.rows));
  } catch (error) {
    return next(error);
  }
});
module.exports = router;