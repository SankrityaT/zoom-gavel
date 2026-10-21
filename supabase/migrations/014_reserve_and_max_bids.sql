-- A max bid that reaches the reserve now makes the lot sell. See the Reserve
-- step at the end of resolve_max_bids; the rest of the function is migration 011.

create or replace function public.resolve_max_bids(p_uuid text)
returns integer
language plpgsql set search_path = public as $$
declare
  s public.auction_sessions%rowtype;
  c public.auction_max_bids%rowtype;
  v_lead_max integer;
  v_lead_verified boolean;
  v_lead_has_ceiling boolean;
  v_amount integer;
  v_step constant integer := 25;
  v_placed integer := 0;
begin
  for i in 1 .. 200 loop
    select * into s from public.auction_sessions where uuid = p_uuid;
    exit when s.status <> 'open';

    -- A challenger's ceiling must beat the price, except where the price was
    -- a plain hand bid (its owner set no ceiling): then a ceiling that sits
    -- exactly on it was committed first and wins the tie.
    select * into c
      from public.auction_max_bids
     where session_uuid = p_uuid and round_no = s.round_no
       and bidder_key is distinct from s.last_bidder_id
       and (max_amount > s.current_bid
            or (max_amount = s.current_bid
                and (s.last_bidder_id is null
                     or not exists (
                       select 1 from public.auction_max_bids l
                        where l.session_uuid = p_uuid and l.round_no = s.round_no
                          and l.bidder_key = s.last_bidder_id))))
     order by max_amount desc, created_at asc
     limit 1;
    exit when not found;

    if s.last_bidder_id is null then
      -- Nobody has bid: the challenger opens at the opening price.
      perform public.apply_bid(p_uuid, s.current_bid, c.bidder_key, c.bidder_name, c.verified, true);
    else
      select max_amount, verified into v_lead_max, v_lead_verified
        from public.auction_max_bids
       where session_uuid = p_uuid and round_no = s.round_no and bidder_key = s.last_bidder_id;
      v_lead_has_ceiling := found;
      v_lead_max := greatest(coalesce(v_lead_max, s.current_bid), s.current_bid);

      if c.max_amount > v_lead_max then
        v_amount := least(c.max_amount, v_lead_max + v_step);
        perform public.apply_bid(p_uuid, v_amount, c.bidder_key, c.bidder_name, c.verified, true);
      elsif not v_lead_has_ceiling and c.max_amount = s.current_bid then
        -- The hand bid landed exactly on this ceiling: the ceiling takes the
        -- lead at the same price.
        perform public.apply_bid(p_uuid, s.current_bid, c.bidder_key, c.bidder_name, c.verified, true);
      else
        -- The leader's ceiling covers the challenger: the leader's bid rises
        -- just far enough to stay ahead.
        v_amount := least(v_lead_max, c.max_amount + v_step);
        exit when v_amount <= s.current_bid;
        perform public.apply_bid(p_uuid, v_amount, s.last_bidder_id, s.last_bidder_name,
                                 coalesce(v_lead_verified, false), true);
      end if;
    end if;
    v_placed := v_placed + 1;
  end loop;

  -- Reserve. A leader whose ceiling reaches the reserve has said they will pay
  -- at least that, so the price rises to the reserve and the lot can sell.
  -- (Without this a lone $600 ceiling on a $500 reserve closes unsold at the
  -- opening price.) The ceiling is never exceeded, and a ceiling below the
  -- reserve changes nothing.
  select * into s from public.auction_sessions where uuid = p_uuid;
  if s.status = 'open' and s.reserve_price is not null and s.last_bidder_id is not null
     and s.current_bid < s.reserve_price then
    select max_amount, verified into v_lead_max, v_lead_verified
      from public.auction_max_bids
     where session_uuid = p_uuid and round_no = s.round_no and bidder_key = s.last_bidder_id;
    if found and v_lead_max >= s.reserve_price then
      perform public.apply_bid(p_uuid, s.reserve_price, s.last_bidder_id, s.last_bidder_name,
                               coalesce(v_lead_verified, false), true);
      v_placed := v_placed + 1;
    end if;
  end if;
  return v_placed;
end;
$$;


notify pgrst, 'reload schema';
