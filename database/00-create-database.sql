-- 使用 postgres 管理数据库执行一次：
-- psql -U postgres -h localhost -f database/00-create-database.sql

CREATE DATABASE rbac
  WITH
  OWNER = postgres
  ENCODING = 'UTF8'
  TEMPLATE = template0;

