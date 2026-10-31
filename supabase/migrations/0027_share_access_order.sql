-- A passport link's access log lists the newest first, but two events can carry the same timestamp
-- (PGlite's clock counts milliseconds; Postgres's microseconds), and the order of tied rows is then
-- arbitrary: a download could show above or below the open just before it. A sequence number records
-- the order the rows were written in, to break those ties. Existing rows get numbers in table order.
alter table app.share_access add column seq bigint generated always as identity;
drop index app.share_access_link_idx;
create index share_access_link_idx on app.share_access (link_id, at desc, seq desc);
