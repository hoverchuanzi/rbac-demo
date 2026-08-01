\encoding UTF8

BEGIN;

-- 1. 创建一级菜单“系统设置”
INSERT INTO menus (
  name,
  path,
  redirect,
  title,
  icon,
  sort_order
)
VALUES (
  'SystemSettings',
  '/system',
  '/system/user',
  '系统设置',
  'lucide:settings',
  60
)
ON CONFLICT (name) DO UPDATE SET
  path = EXCLUDED.path,
  redirect = EXCLUDED.redirect,
  title = EXCLUDED.title,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE;

-- 2. 创建“用户”子菜单
INSERT INTO menus (
  parent_id,
  name,
  path,
  component,
  title,
  icon,
  sort_order
)
SELECT
  parent.id,
  'SystemUser',
  '/system/user',
  '/system/user/index',
  '用户',
  'lucide:users',
  10
FROM menus AS parent
WHERE parent.name = 'SystemSettings'
ON CONFLICT (name) DO UPDATE SET
  parent_id = EXCLUDED.parent_id,
  path = EXCLUDED.path,
  component = EXCLUDED.component,
  title = EXCLUDED.title,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE;

-- 3. 将两个菜单授权给超级管理员和管理员
INSERT INTO role_menus (role_id, menu_id)
SELECT
  role.id,
  menu.id
FROM roles AS role
CROSS JOIN menus AS menu
WHERE role.code IN ('super_admin', 'admin')
  AND menu.name IN ('SystemSettings', 'SystemUser')
ON CONFLICT (role_id, menu_id) DO NOTHING;

COMMIT;