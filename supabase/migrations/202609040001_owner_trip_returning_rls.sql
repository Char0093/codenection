-- INSERT ... RETURNING evaluates the trip SELECT policy before the owner-membership
-- trigger row is visible, so permit the authenticated owner to read that new row.
drop policy "members can read their trips" on public.trips;
create policy "owners and members can read their trips" on public.trips
for select to authenticated using (
  owner_user_id = auth.uid() or public.is_trip_member(id)
);
