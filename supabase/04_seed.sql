create or replace function promover(p_email text, p_rol rol_usuario)
returns text language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  perform set_config('app.bypass_perfil','on',true);
  update perfiles set rol = p_rol where lower(email) = lower(trim(p_email));
  get diagnostics v_n = row_count;
  if v_n = 0 then return 'No existe un usuario con ese email'; end if;
  return 'Listo: ' || p_email || ' ahora es ' || p_rol;
end $$;

revoke execute on function promover(text, rol_usuario) from public;

insert into salas (nombre)
select 'Sala ' || g from generate_series(1,8) g
on conflict (nombre) do nothing;

insert into generos (nombre) values
  ('Acción'),('Aventura'),('Animación'),('Ciencia ficción'),('Comedia'),
  ('Documental'),('Drama'),('Fantasía'),('Suspenso'),('Terror'),('Romance'),('Musical')
on conflict (nombre) do nothing;

insert into peliculas (titulo, sinopsis, duracion_min, restriccion_edad, en_cartelera, destacada, fecha_estreno, precio_preventa, imagen_url, banner_url)
select v.titulo, v.sinopsis, v.duracion_min, v.restriccion_edad, v.en_cartelera, v.destacada, v.fecha_estreno, v.precio_preventa,
       i.bucket || 'posters/' || i.slug || '.jpg', i.bucket || 'banners/' || i.slug || '.jpg'
from (values
  ('Horizonte Cero','Una ingeniera descubre que la estación orbital donde trabaja lleva doce años enviando datos falsos a la Tierra. Para probarlo tiene que llegar al núcleo, el único sector sin cámaras.',142,13,true,true,null,null),
  ('La Última Función','El proyectorista de un cine de barrio a punto de cerrar encuentra una lata de película sin etiqueta. Lo que proyecta esa noche cambia la vida de los siete espectadores que quedaban.',118,0,true,true,null,null),
  ('Marea Negra','Dos hermanos pescadores encuentran un cargamento hundido frente a la costa. Quedárselo significa dejar de ser pobres. Devolverlo significa seguir vivos.',127,18,true,true,null,null),
  ('El Jardín de Invierno','Una botánica regresa al pueblo donde creció para catalogar una especie que solo florece una vez cada cien años, y se reencuentra con todo lo que había dejado atrás.',105,0,true,false,null,null),
  ('Protocolo Lázaro','Un equipo de rescate baja a una mina colapsada para buscar sobrevivientes. A ochocientos metros de profundidad descubren que algo más quedó atrapado ahí abajo.',134,18,true,false,null,null),
  ('Capicúa','Una cajera de supermercado empieza a notar que todos los tickets que emite dan sumas capicúas. Una comedia sobre el azar, la rutina y las señales que elegimos ver.',96,0,true,false,null,null),
  ('Los Días Contados','Un relojero con alzhéimer incipiente decide dejarle a su nieta una serie de pistas escondidas en los relojes que reparó durante cuarenta años.',121,13,true,false,null,null),
  ('Vuelo Nocturno','Animación. Una lechuza que le tiene miedo a la oscuridad tiene que cruzar el bosque entero para llevar un mensaje antes del amanecer.',88,0,true,true,null,null),
  ('Resonancia','Una violinista pierde la audición y descubre que puede percibir la música como vibración. Su búsqueda la lleva a reconstruir el instrumento de su maestro.',130,0,true,false,null,null),
  ('Kilómetro 88','Thriller en una ruta patagónica. Una camionera levanta a un pasajero de madrugada y entiende demasiado tarde que la decisión no tiene vuelta atrás.',112,18,true,false,null,null),
  ('Ciudad Reflejo','Estreno. Un arquitecto descubre que el edificio que diseñó está siendo construido idéntico en otra ciudad, por alguien que nunca vio sus planos.',139,13,false,false,(now()::date + 5),7200),
  ('El Sexto Movimiento','Estreno. Un director de orquesta recibe la partitura inconclusa de un compositor muerto hace un siglo y se obsesiona con terminarla.',124,0,false,false,(now()::date + 12),6900),
  ('Tierra Firme','Estreno. Documental sobre tres familias que vuelven a habitar un pueblo que había sido tragado por una inundación veinte años atrás.',101,0,false,false,(now()::date + 20),6500)
) as v(titulo, sinopsis, duracion_min, restriccion_edad, en_cartelera, destacada, fecha_estreno, precio_preventa)
cross join lateral (
  select 'https://dubpaswolnuvfczqrzny.supabase.co/storage/v1/object/public/imagenes/' as bucket,
         trim(both '-' from regexp_replace(lower(translate(v.titulo,'áéíóúÁÉÍÓÚñÑüÜ','aeiouAEIOUnNuU')),'[^a-z0-9]+','-','g')) as slug
) i
where not exists (select 1 from peliculas p where p.titulo = v.titulo);

insert into peliculas_generos (pelicula_id, genero_id)
select p.id, g.id from peliculas p, generos g
where (p.titulo, g.nombre) in (
  ('Horizonte Cero','Ciencia ficción'),('Horizonte Cero','Suspenso'),
  ('La Última Función','Drama'),('La Última Función','Fantasía'),
  ('Marea Negra','Suspenso'),('Marea Negra','Drama'),('Marea Negra','Acción'),
  ('El Jardín de Invierno','Drama'),('El Jardín de Invierno','Romance'),
  ('Protocolo Lázaro','Terror'),('Protocolo Lázaro','Suspenso'),
  ('Capicúa','Comedia'),('Capicúa','Romance'),
  ('Los Días Contados','Drama'),('Los Días Contados','Aventura'),
  ('Vuelo Nocturno','Animación'),('Vuelo Nocturno','Aventura'),('Vuelo Nocturno','Fantasía'),
  ('Resonancia','Drama'),('Resonancia','Musical'),
  ('Kilómetro 88','Suspenso'),('Kilómetro 88','Acción'),
  ('Ciudad Reflejo','Ciencia ficción'),('Ciudad Reflejo','Suspenso'),
  ('El Sexto Movimiento','Drama'),('El Sexto Movimiento','Musical'),
  ('Tierra Firme','Documental'),('Tierra Firme','Drama'))
on conflict do nothing;

insert into categorias (nombre) values
  ('Pochoclos'),('Bebidas'),('Golosinas'),('Salados'),('Helados')
on conflict (nombre) do nothing;

insert into productos (categoria_id, nombre, descripcion, precio, imagen_url)
select c.id, v.nombre, v.descripcion, v.precio, i.bucket || 'productos/' || i.slug || '.jpg'
from (values
  ('Pochoclos','Pochoclos chico','Balde de 60g, dulce o salado',3200),
  ('Pochoclos','Pochoclos mediano','Balde de 110g, dulce o salado',4500),
  ('Pochoclos','Pochoclos grande','Balde de 180g para compartir',5900),
  ('Bebidas','Gaseosa chica','473 ml',2600),
  ('Bebidas','Gaseosa grande','750 ml',3800),
  ('Bebidas','Agua mineral','500 ml sin gas',2100),
  ('Bebidas','Café','Expreso o con leche',2400),
  ('Golosinas','Caja de chocolates','Surtido de 12 bombones',4200),
  ('Golosinas','Pastillas','Rollo de pastillas de fruta',1500),
  ('Golosinas','Chocolate con maní','Tableta de 80g',2800),
  ('Salados','Nachos con queso','Porción con salsa cheddar',5400),
  ('Salados','Papas fritas','Porción grande',4100),
  ('Helados','Helado palito','Bombón escocés',2900),
  ('Helados','Pote de helado','Dos bochas a elección',4600)
) as v(cat, nombre, descripcion, precio)
join categorias c on c.nombre = v.cat
cross join lateral (
  select 'https://dubpaswolnuvfczqrzny.supabase.co/storage/v1/object/public/imagenes/' as bucket,
         trim(both '-' from regexp_replace(lower(translate(v.nombre,'áéíóúÁÉÍÓÚñÑüÜ','aeiouAEIOUnNuU')),'[^a-z0-9]+','-','g')) as slug
) i
where not exists (select 1 from productos p where p.nombre = v.nombre);

insert into combos (nombre, descripcion, precio, imagen_url)
select v.nombre, v.descripcion, v.precio, i.bucket || 'combos/' || i.slug || '.jpg'
from (values
  ('Combo Clásico','Entrada + pochoclos medianos + gaseosa chica',11900),
  ('Combo Pareja','2 entradas + pochoclos grandes + 2 gaseosas grandes',24500),
  ('Combo Familiar','4 entradas + 2 pochoclos grandes + 4 gaseosas',46900),
  ('Combo Dulce','Entrada + pochoclos chicos + caja de chocolates',13200)
) as v(nombre, descripcion, precio)
cross join lateral (
  select 'https://dubpaswolnuvfczqrzny.supabase.co/storage/v1/object/public/imagenes/' as bucket,
         trim(both '-' from regexp_replace(lower(translate(v.nombre,'áéíóúÁÉÍÓÚñÑüÜ','aeiouAEIOUnNuU')),'[^a-z0-9]+','-','g')) as slug
) i
where not exists (select 1 from combos c where c.nombre = v.nombre);

insert into cupones (codigo, descripcion, porcentaje, tipo, edad_minima)
values
  ('BIENVENIDA','Descuento de bienvenida para tu primera compra',20,'bienvenida',null),
  ('PLATEA50','Descuento para mayores de 50 años',25,'edad',50),
  ('JUBILADOS','Beneficio para mayores de 65 años',35,'edad',65)
on conflict (codigo) do nothing;

insert into recompensas (nombre, tipo, producto_id, costo_puntos)
select v.nombre, v.tipo::tipo_recompensa, p.id, v.costo
from (values
  ('Entrada gratis','entrada',null,500),
  ('Pochoclos grande','producto','Pochoclos grande',150),
  ('Gaseosa grande','producto','Gaseosa grande',90),
  ('Nachos con queso','producto','Nachos con queso',140),
  ('Caja de chocolates','producto','Caja de chocolates',110)
) as v(nombre, tipo, prod, costo)
left join productos p on p.nombre = v.prod
where not exists (select 1 from recompensas r where r.nombre = v.nombre);

do $$
declare
  v_pel record; v_dia int; v_h int; v_ini timestamptz; v_fin timestamptz;
  v_sala bigint; v_horarios int[] := array[13,16,19,22];
begin
  if exists (select 1 from funciones) then return; end if;
  for v_dia in -20..7 loop
    for v_pel in select id, duracion_min from peliculas where en_cartelera order by id loop
      foreach v_h in array v_horarios loop
        v_ini := date_trunc('day', now()) + make_interval(days => v_dia, hours => v_h);
        v_fin := v_ini + make_interval(mins => v_pel.duracion_min);
        select s.id into v_sala from salas s
         where not exists (select 1 from funciones f
                            where f.sala_id = s.id
                              and f.ocupacion && tstzrange(v_ini, v_fin + interval '30 minutes','[)'))
         order by s.id limit 1;
        if v_sala is not null then
          insert into funciones (pelicula_id, sala_id, inicio, fin, formato, idioma, precio_base)
          values (v_pel.id, v_sala, v_ini, v_fin,
                  (array['2D','2D','3D','4D','5D'])[1 + abs(v_pel.id + v_dia + v_h) % 5]::formato_funcion,
                  (array['castellano','subtitulada'])[1 + abs(v_pel.id + v_h) % 2]::idioma_funcion,
                  6500 + (abs(v_pel.id * 137 + v_h * 53) % 5) * 400);
        end if;
      end loop;
    end loop;
  end loop;
end $$;

do $$
declare
  v_f record; v_compra compras; v_n int; v_i int; v_but bigint; v_precio numeric;
  v_codigo text; v_prod record;
begin
  if (select count(*) from compras) > 0 then return; end if;

  for v_f in
    select f.id, f.sala_id, f.precio_base, f.precio_vip, f.inicio
      from funciones f where f.inicio < now() and f.inicio > now() - interval '21 days'
     order by f.inicio
  loop
    if (abs(hashtext(v_f.id::text)) % 10) < 6 then continue; end if;

    v_n := 1 + (abs(hashtext(v_f.id::text || 'n')) % 5);
    v_codigo := substr(upper(replace(gen_random_uuid()::text, '-', '')), 1, 12);

    insert into compras (usuario_id, email_contacto, codigo, funcion_id, creado_en)
    values (null, 'demo@cinenova.app', v_codigo, v_f.id, v_f.inicio - interval '2 hours')
    returning * into v_compra;

    for v_i in 1..v_n loop
      select b.id, case when b.tipo='vip' then v_f.precio_vip else v_f.precio_base end
        into v_but, v_precio
        from butacas b
       where b.sala_id = v_f.sala_id
         and not exists (select 1 from entradas e where e.funcion_id = v_f.id and e.butaca_id = b.id and e.activa)
       order by (abs(hashtext(b.id::text || v_f.id::text || v_i::text)))
       limit 1;
      if v_but is not null then
        insert into entradas (compra_id, funcion_id, butaca_id, precio)
        values (v_compra.id, v_f.id, v_but, v_precio)
        on conflict do nothing;
      end if;
    end loop;

    if (abs(hashtext(v_f.id::text || 'p')) % 10) < 7 then
      for v_prod in
        select p.id, p.nombre, p.precio from productos p
         order by (abs(hashtext(p.id::text || v_f.id::text))) limit 1 + (abs(hashtext(v_f.id::text)) % 2)
      loop
        insert into compra_items (compra_id, producto_id, nombre, cantidad, precio_unitario)
        values (v_compra.id, v_prod.id, v_prod.nombre,
                1 + (abs(hashtext(v_prod.id::text || v_f.id::text)) % 2), v_prod.precio);
      end loop;
    end if;

    update compras c
       set subtotal = coalesce((select sum(e.precio) from entradas e where e.compra_id = c.id and e.activa),0)
                    + coalesce((select sum(ci.cantidad * ci.precio_unitario) from compra_items ci where ci.compra_id = c.id),0)
     where c.id = v_compra.id;

    update compras set total = subtotal, entrada_validada = true, entrada_validada_en = creado_en + interval '2 hours'
     where id = v_compra.id;
  end loop;
end $$;

do $$
declare
  v_pel record; v_dia int; v_minutos int; v_ini timestamptz; v_fin timestamptz; v_sala bigint;
begin
  for v_pel in
    select p.id, p.duracion_min, p.fecha_estreno from peliculas p
     where not p.en_cartelera and p.fecha_estreno is not null
       and not exists (select 1 from funciones f where f.pelicula_id = p.id)
     order by p.id
  loop
    for v_dia in 0..6 loop
      foreach v_minutos in array array[1020, 1200, 1350] loop
        v_ini := ((v_pel.fecha_estreno + v_dia)::timestamp + make_interval(mins => v_minutos))
                 at time zone 'America/Argentina/Buenos_Aires';
        v_fin := v_ini + make_interval(mins => v_pel.duracion_min);
        select s.id into v_sala from salas s
         where not exists (select 1 from funciones f
                            where f.sala_id = s.id
                              and f.ocupacion && tstzrange(v_ini, v_fin + interval '30 minutes','[)'))
         order by s.id limit 1;
        if v_sala is not null then
          insert into funciones (pelicula_id, sala_id, inicio, fin, formato, idioma, precio_base)
          values (v_pel.id, v_sala, v_ini, v_fin,
                  (array['2D','3D','4D'])[1 + abs(v_pel.id + v_dia) % 3]::formato_funcion,
                  (array['castellano','subtitulada'])[1 + abs(v_pel.id + v_minutos) % 2]::idioma_funcion,
                  7900);
        end if;
      end loop;
    end loop;
  end loop;
end $$;

update compras
   set medio_pago       = case when total > 0 then 'tarjeta_credito'::medio_pago else 'sin_cargo'::medio_pago end,
       tarjeta_marca    = case when total > 0 then 'Visa' end,
       tarjeta_ultimos4 = case when total > 0 then '4242' end
 where medio_pago is null;
