-- Fixes 202609050006_traveler_profiles_poi_catalog.sql: that migration revoked all privileges on
-- poi_catalog from every role, including service_role, then only granted select back to
-- authenticated. It never restored write access for service_role, even though the table is
-- documented as "written only by the seed script under service_role" -- the seed script has been
-- failing with "permission denied for table poi_catalog" ever since. Supabase's service_role
-- already bypasses RLS by default; this is a missing table-level GRANT, not an RLS gap.
grant select, insert, update on public.poi_catalog to service_role;
