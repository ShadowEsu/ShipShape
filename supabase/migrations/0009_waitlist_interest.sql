-- What a waitlist sign-up asked to hear about besides accounts opening (today: Collect going on
-- sale), so demand for a feature that isn't sold can be counted.
alter table app.waitlist add column interests text[] not null default '{}' check (interests <@ array['collect']);
