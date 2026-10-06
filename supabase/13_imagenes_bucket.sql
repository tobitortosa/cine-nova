do $$
declare
  v_bucket constant text := 'https://dubpaswolnuvfczqrzny.supabase.co/storage/v1/object/public/imagenes/';
begin
  alter table peliculas disable trigger trg_auditar_peliculas;
  alter table productos disable trigger trg_auditar_productos;
  alter table combos disable trigger trg_auditar_combos;

  update peliculas
     set imagen_url = case
           when imagen_url ~ '^/posters/[a-z0-9-]+-banner\.jpg$'
             then regexp_replace(imagen_url, '^/posters/([a-z0-9-]+)-banner\.jpg$', v_bucket || 'banners/\1.jpg')
           when imagen_url ~ '^/posters/[a-z0-9-]+\.jpg$'
             then regexp_replace(imagen_url, '^/posters/([a-z0-9-]+)\.jpg$', v_bucket || 'posters/\1.jpg')
           else imagen_url
         end,
         banner_url = case
           when banner_url ~ '^/posters/[a-z0-9-]+-banner\.jpg$'
             then regexp_replace(banner_url, '^/posters/([a-z0-9-]+)-banner\.jpg$', v_bucket || 'banners/\1.jpg')
           when banner_url ~ '^/posters/[a-z0-9-]+\.jpg$'
             then regexp_replace(banner_url, '^/posters/([a-z0-9-]+)\.jpg$', v_bucket || 'posters/\1.jpg')
           else banner_url
         end
   where imagen_url ~ '^/posters/[a-z0-9-]+\.jpg$'
      or banner_url ~ '^/posters/[a-z0-9-]+\.jpg$';

  update productos
     set imagen_url = case
           when imagen_url ~ '^/candy/combo-[a-z0-9-]+\.jpg$'
             then regexp_replace(imagen_url, '^/candy/([a-z0-9-]+)\.jpg$', v_bucket || 'combos/\1.jpg')
           else regexp_replace(imagen_url, '^/candy/([a-z0-9-]+)\.jpg$', v_bucket || 'productos/\1.jpg')
         end
   where imagen_url ~ '^/candy/[a-z0-9-]+\.jpg$';

  update combos
     set imagen_url = case
           when imagen_url ~ '^/candy/combo-[a-z0-9-]+\.jpg$'
             then regexp_replace(imagen_url, '^/candy/([a-z0-9-]+)\.jpg$', v_bucket || 'combos/\1.jpg')
           else regexp_replace(imagen_url, '^/candy/([a-z0-9-]+)\.jpg$', v_bucket || 'productos/\1.jpg')
         end
   where imagen_url ~ '^/candy/[a-z0-9-]+\.jpg$';

  alter table peliculas enable trigger trg_auditar_peliculas;
  alter table productos enable trigger trg_auditar_productos;
  alter table combos enable trigger trg_auditar_combos;
end $$;

select 'peliculas' as tabla,
       count(*) filter (where imagen_url like 'https://dubpaswolnuvfczqrzny.supabase.co/storage/v1/object/public/imagenes/%') as en_el_bucket,
       count(*) filter (where imagen_url ~ '^/(posters|candy)/' or banner_url ~ '^/(posters|candy)/') as sin_pasar
  from peliculas
union all
select 'productos',
       count(*) filter (where imagen_url like 'https://dubpaswolnuvfczqrzny.supabase.co/storage/v1/object/public/imagenes/%'),
       count(*) filter (where imagen_url ~ '^/(posters|candy)/')
  from productos
union all
select 'combos',
       count(*) filter (where imagen_url like 'https://dubpaswolnuvfczqrzny.supabase.co/storage/v1/object/public/imagenes/%'),
       count(*) filter (where imagen_url ~ '^/(posters|candy)/')
  from combos;
