-- Create the database the integration suite uses, alongside the development one.
--
-- Runs once, the first time the postgres container initialises its data volume. Set
-- TEST_DATABASE_URL to point at it and the suite will use this real PostgreSQL instead of
-- booting its own embedded server (docs/08-testing.md).
--
-- Encoding and collation match the development database exactly, so index ordering and text
-- comparison behave identically in both.
CREATE DATABASE aftergame_test
  WITH OWNER = aftergame
       ENCODING = 'UTF8'
       LC_COLLATE = 'C'
       LC_CTYPE = 'C'
       TEMPLATE = template0;
