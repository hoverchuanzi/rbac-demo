const pool = require('../db');
const { failure } = require('../response');

function authorize(permissionCode) {
  return async (req, res, next) => {
    try {
      const permissionResult = await pool.query(
        `
          SELECT 1
          FROM user_roles AS ur
          JOIN roles AS r
            ON r.id = ur.role_id
            AND r.is_active = TRUE
          JOIN role_permissions AS rp
            ON rp.role_id = r.id
          JOIN permissions AS p
            ON p.id = rp.permission_id
            AND p.is_active = TRUE
          WHERE ur.user_id = $1
            AND p.code = $2
          LIMIT 1
        `,
        [req.auth.userId, permissionCode],
      );

      if (permissionResult.rowCount === 0) {
        return failure(res, 403, '没有执行该操作的权限');
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = authorize;