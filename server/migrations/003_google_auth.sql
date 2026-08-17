alter table users drop column if exists password_hash;
alter table users add column if not exists google_subject text;

create unique index if not exists users_google_subject_key
  on users(google_subject)
  where google_subject is not null;
