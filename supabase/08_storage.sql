insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('imagenes', 'imagenes', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
   set name               = excluded.name,
       public             = excluded.public,
       file_size_limit    = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists imagenes_select on storage.objects;
create policy imagenes_select on storage.objects for select
  to authenticated
  using (bucket_id = 'imagenes' and public.es_admin());

drop policy if exists imagenes_insert on storage.objects;
create policy imagenes_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'imagenes'
    and public.es_admin()
    and (storage.foldername(name))[1] in ('posters', 'banners', 'productos', 'combos')
    and array_length(storage.foldername(name), 1) = 1
    and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
  );

drop policy if exists imagenes_delete on storage.objects;
create policy imagenes_delete on storage.objects for delete
  to authenticated
  using (bucket_id = 'imagenes' and public.es_admin());
