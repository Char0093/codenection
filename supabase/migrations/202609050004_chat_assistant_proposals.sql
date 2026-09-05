-- Implementation_Plan.md Task 3.3: the embedded assistant proposes; it never activates a plan.
-- A chat-suggested change reuses the exact validated 'gemini_itinerary' payload shape and the
-- existing accept/reject/materialization path in decide_trip_proposal -- only the trip owner can
-- accept it, identical to a proposal generated from the "Generate plan" button. Any member may
-- prompt the assistant into creating a pending candidate; only a human can activate one.

create function public.save_chat_proposal(
  target_trip_id uuid, author_member_id uuid, proposal_payload jsonb, model_identifier text, announcement text
) returns public.agent_proposals language plpgsql security definer set search_path = '' as $$
declare
  v_trip public.trips;
  v_proposal public.agent_proposals;
  v_validation jsonb;
  v_now timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_trip from public.trips t where t.id = target_trip_id for update;
  if not found then raise exception 'Trip not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.trip_members tm
    where tm.id = author_member_id and tm.trip_id = target_trip_id and tm.user_id = auth.uid()
  ) then
    raise exception 'Author must be the caller''s own membership on this trip' using errcode = '42501';
  end if;
  if save_chat_proposal.model_identifier is null
    or char_length(public.ordinary_trim(save_chat_proposal.model_identifier)) not between 1 and 200 then
    raise exception 'Invalid model identifier' using errcode = '22023';
  end if;
  if char_length(public.ordinary_trim(announcement)) not between 1 and 4000 then
    raise exception 'Invalid announcement' using errcode = '22023';
  end if;

  v_validation := public.validate_trip_proposal(v_trip, proposal_payload);
  v_now := clock_timestamp();
  insert into public.agent_proposals(trip_id, proposal_type, status, title, summary, payload,
    model_identifier, validation_result, trip_revision, expires_at, created_at)
  values (target_trip_id, 'gemini_itinerary', 'pending', 'Assistant suggestion', proposal_payload->>'summary',
    proposal_payload, save_chat_proposal.model_identifier, v_validation, v_trip.revision,
    v_now + interval '24 hours', v_now)
  returning * into v_proposal;

  insert into public.chat_messages(trip_id, author_member_id, author_kind, body, proposal_id)
  values (target_trip_id, null, 'assistant', public.ordinary_trim(announcement), v_proposal.id);

  return v_proposal;
end;
$$;

-- A plain assistant reply with no proposal attached (an answered question, not a suggested change).
create function public.post_assistant_message(target_trip_id uuid, body text)
returns public.chat_messages language plpgsql security definer set search_path = '' as $$
declare
  v_message public.chat_messages;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not exists (select 1 from public.trip_members tm where tm.trip_id = target_trip_id and tm.user_id = auth.uid()) then
    raise exception 'Trip membership required' using errcode = '42501';
  end if;
  if char_length(public.ordinary_trim(body)) not between 1 and 4000 then
    raise exception 'Invalid message body' using errcode = '22023';
  end if;
  insert into public.chat_messages(trip_id, author_member_id, author_kind, body)
  values (target_trip_id, null, 'assistant', public.ordinary_trim(body))
  returning * into v_message;
  return v_message;
end;
$$;

revoke all on function public.save_chat_proposal(uuid, uuid, jsonb, text, text),
  public.post_assistant_message(uuid, text) from public, anon, service_role;
grant execute on function public.save_chat_proposal(uuid, uuid, jsonb, text, text),
  public.post_assistant_message(uuid, text) to authenticated;
