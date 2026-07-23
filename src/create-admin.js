const bcrypt = require('bcrypt');
const pool = require('./db');

async function createAdmin() {
  // 目前先直接写在脚本里。
  // 脚本执行成功后，请删除这里的明文密码或删除整个脚本。
  const username = 'stefanie';
  const password = '780723';
  const realName = '孙燕姿';
  const email = null;
  // const username = 'flh';
  // const password = '001018';
  // const realName = '范流洪';
  // const email = null;

  // bcrypt 的计算成本。
  // 12 比较适合目前的 Demo，数值越大计算越慢。
  const saltRounds = 12;

  const client = await pool.connect();

  try {
    // 用户和角色必须同时创建成功，所以使用事务。
    await client.query('BEGIN');

    // 先检查用户名是否已经存在。
    const existingUserResult = await client.query(
      `
        SELECT id
        FROM users
        WHERE lower(username) = lower($1)
      `,
      [username],
    );

    if (existingUserResult.rowCount > 0) {
      throw new Error(`用户 ${username} 已经存在`);
    }

    // 把明文密码转换成 bcrypt 哈希。
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // 创建用户。
    // $1、$2 等是参数占位符，可以避免 SQL 注入。
    const userResult = await client.query(
      `
        INSERT INTO users (
          username,
          password_hash,
          real_name,
          email
        )
        VALUES ($1, $2, $3, $4)
        RETURNING id, username, real_name, email, is_active, created_at
      `,
      [username, passwordHash, realName, email],
    );

    const user = userResult.rows[0];

    // 查找初始化 SQL 中创建的超级管理员角色。
    const roleResult = await client.query(
      `
        SELECT id, code
        FROM roles
        WHERE code = $1
          AND is_active = TRUE
      `,
      ['super_admin'],
    );

    if (roleResult.rowCount === 0) {
      throw new Error(
        '没有找到可用的 super_admin 角色，请先执行 database/01-schema.sql',
      );
    }

    const role = roleResult.rows[0];

    // 将用户和角色关联起来。
    await client.query(
      `
        INSERT INTO user_roles (user_id, role_id)
        VALUES ($1, $2)
      `,
      [user.id, role.id],
    );

    await client.query('COMMIT');

    console.log('管理员创建成功：');
    console.log({
      id: user.id,
      username: user.username,
      realName: user.real_name,
      email: user.email,
      role: role.code,
      isActive: user.is_active,
      createdAt: user.created_at,
    });
  } catch (error) {
    // 中间任何一步失败，都撤销已经执行的数据库操作。
    await client.query('ROLLBACK');
    console.error('管理员创建失败：', error.message);
    process.exitCode = 1;
  } finally {
    // 无论成功还是失败，都释放连接并关闭连接池。
    client.release();
    await pool.end();
  }
}

createAdmin();
