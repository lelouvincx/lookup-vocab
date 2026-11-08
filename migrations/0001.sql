pragma foreign_keys = on;
create table if not exists settings (id integer primary key check (id = 1), daily_limit integer not null check (daily_limit between 0 and 100), restoring integer not null default 0);
insert or ignore into settings (id, daily_limit) values (1, 10);
create table if not exists cards (
  id text primary key, normalized text not null unique, source text not null, translation text not null,
  status text not null default 'active' check (status in ('active','suspended','deleted')),
  step integer not null default 0, due integer not null, introduced integer,
  version integer not null default 0, lookups integer not null default 1,
  created integer not null, updated integer not null
);
create index if not exists cards_queue on cards(status, due, introduced);
create table if not exists captures (id text primary key, payload text not null, at integer not null);
create table if not exists reviews (
  id text primary key, card_id text not null references cards(id), grade text not null,
  at integer not null, day text not null, was_new integer not null,
  before_step integer not null, after_step integer not null, due integer not null
);
create index if not exists reviews_day on reviews(day, was_new);
create table if not exists mutations (id text primary key, kind text not null, payload text not null);
create table if not exists tokens (id text primary key, hash text not null unique, created integer not null, revoked integer);

-- The event insertion and every resulting state change share one SQLite transaction.
create trigger if not exists capture_apply after insert on captures when (select restoring from settings where id = 1) = 0 begin
  insert into cards (id, normalized, source, translation, due, created, updated)
  values (json_extract(new.payload,'$.cardId'), json_extract(new.payload,'$.normalized'),
    json_extract(new.payload,'$.sourceText'), json_extract(new.payload,'$.translatedText'), new.at, new.at, new.at)
  on conflict(normalized) do update set
    translation = excluded.translation, due = case when cards.status = 'active' then new.at else cards.due end,
    lookups = cards.lookups + 1, version = cards.version + 1, updated = new.at;
end;

create trigger if not exists review_apply before insert on reviews when (select restoring from settings where id = 1) = 0 begin
  select case when not exists (select 1 from cards where id = new.card_id and status = 'active' and step = new.before_step and due <= new.at)
    then raise(abort, 'stale_review') end;
  select case when new.was_new = 1 and (select count(*) from reviews where day = new.day and was_new = 1) >= (select daily_limit from settings where id = 1)
    then raise(abort, 'daily_limit') end;
  update cards set step = new.after_step, due = new.due, introduced = coalesce(introduced, new.at), version = version + 1, updated = new.at where id = new.card_id;
end;

create trigger if not exists mutation_apply after insert on mutations begin
  update settings set daily_limit = json_extract(new.payload,'$.dailyLimit') where id = 1 and new.kind = 'settings';
  update cards set status = json_extract(new.payload,'$.status'), version = version + 1
    where id = json_extract(new.payload,'$.cardId') and new.kind = 'card';
  update tokens set revoked = json_extract(new.payload,'$.at') where id = json_extract(new.payload,'$.tokenId') and new.kind = 'revoke';
end;
