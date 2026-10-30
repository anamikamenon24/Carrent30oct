-- btree_gist lets GiST exclusion constraints combine "vehicle_id WITH =" and "period WITH &&".
-- It is a trusted extension (PostgreSQL 13+, Neon), so the database owner can create it.
CREATE EXTENSION IF NOT EXISTS btree_gist;
