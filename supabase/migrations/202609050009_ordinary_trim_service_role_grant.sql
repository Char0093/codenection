-- Fixes 202609030004_narrow_trip_scope.sql: it revoked execute on ordinary_trim(text) from every
-- role, including service_role, then granted it back only to authenticated. poi_catalog's
-- name/check constraint calls public.ordinary_trim(name), and a check constraint runs as whatever
-- role performs the INSERT -- so the seed script's service_role insert fails with "permission
-- denied for function ordinary_trim" even after 202609050008 restored its table-level grant.
grant execute on function public.ordinary_trim(text) to service_role;
