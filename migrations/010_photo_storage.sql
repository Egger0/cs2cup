do $migration$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage.buckets is unavailable; skipping CloudBase photo bucket setup';
    return;
  end if;

  execute $sql$
    insert into storage.buckets (
      id,
      name,
      public,
      file_size_limit,
      allowed_mime_types
    )
    values (
      'cs2cup-photos',
      'cs2cup-photos',
      false,
      10 * 1024 * 1024,
      array['image/jpeg', 'image/png', 'image/webp']
    )
    on conflict (id) do update
    set
      public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types
  $sql$;
end
$migration$;
