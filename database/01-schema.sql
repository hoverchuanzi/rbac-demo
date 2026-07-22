-- 在 rbac 数据库中执行：
-- psql -U postgres -h localhost -d rbac -f database/01-schema.sql
-- PGCLIENTENCODING=UTF8 psql -U postgres -h localhost -d rbac -f database/01-schema.sql

BEGIN;

CREATE TABLE users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username VARCHAR(50) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  real_name VARCHAR(100) NOT NULL,
  avatar VARCHAR(500),
  email VARCHAR(255),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT users_username_not_blank CHECK (btrim(username) <> ''),
  CONSTRAINT users_real_name_not_blank CHECK (btrim(real_name) <> '')
);

-- 用户名和邮箱使用不区分大小写的唯一约束。
CREATE UNIQUE INDEX users_username_lower_uq ON users (lower(username));
CREATE UNIQUE INDEX users_email_lower_uq
  ON users (lower(email))
  WHERE email IS NOT NULL;

CREATE TABLE roles (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(500),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT roles_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT roles_name_not_blank CHECK (btrim(name) <> '')
);

CREATE TABLE permissions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  resource VARCHAR(50) NOT NULL,
  action VARCHAR(50) NOT NULL,
  description VARCHAR(500),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT permissions_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT permissions_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT permissions_resource_action_uq UNIQUE (resource, action)
);

CREATE TABLE menus (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parent_id BIGINT REFERENCES menus(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL UNIQUE,
  path VARCHAR(255) NOT NULL,
  component VARCHAR(255),
  redirect VARCHAR(255),
  title VARCHAR(100) NOT NULL,
  icon VARCHAR(100),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  keep_alive BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  extra_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT menus_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT menus_path_not_blank CHECK (btrim(path) <> ''),
  CONSTRAINT menus_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT menus_parent_path_uq UNIQUE (parent_id, path)
);

CREATE INDEX menus_parent_sort_idx ON menus (parent_id, sort_order, id);
CREATE INDEX menus_extra_meta_gin_idx ON menus USING GIN (extra_meta);

CREATE TABLE user_roles (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX user_roles_role_id_idx ON user_roles (role_id);

CREATE TABLE role_permissions (
  role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX role_permissions_permission_id_idx
  ON role_permissions (permission_id);

CREATE TABLE role_menus (
  role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  menu_id BIGINT NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (role_id, menu_id)
);

CREATE INDEX role_menus_menu_id_idx ON role_menus (menu_id);

-- 自动维护 updated_at，避免每个 UPDATE 都手动赋值。
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER roles_set_updated_at
BEFORE UPDATE ON roles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER permissions_set_updated_at
BEFORE UPDATE ON permissions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER menus_set_updated_at
BEFORE UPDATE ON menus
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 基础角色。
INSERT INTO roles (code, name, description) VALUES
  ('super_admin', '超级管理员', '拥有系统全部权限'),
  ('admin', '管理员', '负责用户、角色、权限和菜单管理'),
  ('viewer', '只读用户', '只能查看系统数据');

-- 权限码直接供 Vben Admin 的 access codes 和 Express 鉴权中间件使用。
INSERT INTO permissions (code, name, resource, action) VALUES
  ('user:list', '查看用户', 'user', 'list'),
  ('user:create', '新增用户', 'user', 'create'),
  ('user:update', '修改用户', 'user', 'update'),
  ('user:delete', '删除用户', 'user', 'delete'),
  ('role:list', '查看角色', 'role', 'list'),
  ('role:create', '新增角色', 'role', 'create'),
  ('role:update', '修改角色', 'role', 'update'),
  ('role:delete', '删除角色', 'role', 'delete'),
  ('permission:list', '查看权限', 'permission', 'list'),
  ('menu:list', '查看菜单', 'menu', 'list'),
  ('menu:create', '新增菜单', 'menu', 'create'),
  ('menu:update', '修改菜单', 'menu', 'update'),
  ('menu:delete', '删除菜单', 'menu', 'delete');

-- Vben Admin 动态菜单示例。component 对应前端 views 下的文件路径。
WITH system_menu AS (
  INSERT INTO menus (name, path, redirect, title, icon, sort_order)
  VALUES (
    'System',
    '/system',
    '/system/user',
    '系统管理',
    'lucide:settings',
    10
  )
  RETURNING id
)
INSERT INTO menus
  (parent_id, name, path, component, title, icon, sort_order)
SELECT id, 'UserManagement', '/system/user', '/system/user/index',
       '用户管理', 'lucide:users', 10
FROM system_menu
UNION ALL
SELECT id, 'RoleManagement', '/system/role', '/system/role/index',
       '角色管理', 'lucide:shield-check', 20
FROM system_menu
UNION ALL
SELECT id, 'MenuManagement', '/system/menu', '/system/menu/index',
       '菜单管理', 'lucide:menu', 30
FROM system_menu;

-- 超级管理员和管理员拥有全部权限、全部菜单。
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code IN ('super_admin', 'admin');

INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, m.id
FROM roles r
CROSS JOIN menus m
WHERE r.code IN ('super_admin', 'admin');

-- 只读角色仅拥有查看权限；默认只展示系统和用户管理菜单。
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.action = 'list'
WHERE r.code = 'viewer';

INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, m.id
FROM roles r
JOIN menus m ON m.name IN ('System', 'UserManagement')
WHERE r.code = 'viewer';

COMMIT;