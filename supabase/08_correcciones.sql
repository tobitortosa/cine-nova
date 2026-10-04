do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'combos' and column_name = 'entradas_incluidas') then
    alter table combos add column entradas_incluidas int not null default 0;
    alter table combos disable trigger user;
    update combos
       set entradas_incluidas = least(10, case
             when descripcion ~* '^\s*[0-9]+\s+entradas?\M' then substring(descripcion from '^\s*([0-9]+)')::numeric
             when descripcion ~* '^\s*entrada\M' then 1
             else 0
           end);
    alter table combos enable trigger user;
  end if;
end $$;

do $$ begin
  alter table combos add constraint combos_entradas_incluidas_rango check (entradas_incluidas between 0 and 10);
exception when duplicate_object then null; end $$;

alter table compras add column if not exists descuento_combos numeric(10,2) not null default 0;

alter table correos add column if not exists pedido_http bigint;

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'peliculas' and column_name = 'estreno_procesado') then
    alter table peliculas add column estreno_procesado boolean not null default false;
    alter table peliculas disable trigger user;
    update peliculas set estreno_procesado = true
     where en_cartelera or (fecha_estreno is not null and fecha_estreno <= hoy_local());
    alter table peliculas enable trigger user;
  end if;
end $$;

update perfiles set tipo_sangre = 'O' || substr(tipo_sangre, 2) where tipo_sangre in ('0+', '0-');

delete from log_actividad
 where usuario_id is null and accion = 'x' and entidad = 'x' and entidad_id = 'x';

update resenias set comentario = left(comentario, 1000) where char_length(comentario) > 1000;

do $$ begin
  alter table resenias add constraint resenias_comentario_largo check (char_length(comentario) <= 1000);
exception when duplicate_object then null; end $$;

create or replace function huella_de_sesion(p_sesion text)
returns text language sql immutable as $$
  select encode(sha256(convert_to(p_sesion, 'UTF8')), 'hex');
$$;

update reservas set sesion = huella_de_sesion(sesion) where sesion !~ '^[0-9a-f]{64}$';

create or replace function escapar_html(p_texto text)
returns text language sql immutable as $$
  select replace(replace(replace(replace(replace(coalesce(p_texto, ''),
         '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;');
$$;

create or replace function enmascarar_email(p_email text)
returns text language sql immutable as $$
  select case
    when p_email is null then null
    when position('@' in p_email) < 2 then '••••'
    else left(split_part(p_email, '@', 1), case when length(split_part(p_email, '@', 1)) > 2 then 2 else 1 end)
         || '••••@' || substring(p_email from position('@' in p_email) + 1)
  end;
$$;

create or replace function funcion_con_ventas(p_funcion_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from entradas e
                   join compras c on c.id = e.compra_id
                  where e.funcion_id = p_funcion_id and e.activa and c.estado = 'pagada');
$$;

create or replace function public.fn_perfiles_proteger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.bypass_perfil', true), '') <> 'on' and not public.es_admin() then
    new.rol := old.rol;
    new.puntos := old.puntos;
    new.credito := old.credito;
    new.cupon_bienvenida_usado := old.cupon_bienvenida_usado;
    new.email := old.email;
    new.creado_en := old.creado_en;
    if old.fecha_nacimiento is not null then
      new.fecha_nacimiento := old.fecha_nacimiento;
    end if;
  end if;
  return new;
end $$;

create or replace function fn_salas_butacas()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform generar_butacas(new.id);
  return new;
end $$;

create or replace function fn_funciones_ocupacion()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_duracion int; v_sala text;
begin
  select duracion_min into v_duracion from peliculas where id = new.pelicula_id;
  if v_duracion is null then
    raise exception 'La película no existe';
  end if;

  if tg_op = 'INSERT'
     or new.inicio is distinct from old.inicio
     or new.pelicula_id is distinct from old.pelicula_id
     or new.fin is distinct from old.fin then
    new.fin := new.inicio + make_interval(mins => v_duracion);
  end if;
  new.ocupacion := tstzrange(new.inicio, new.fin + interval '30 minutes', '[)');

  if new.precio_vip = 0 then
    new.precio_vip := round(new.precio_base * 1.5, 2);
  end if;
  if new.precio_vip < new.precio_base then
    raise exception 'El precio VIP no puede ser menor que el precio estándar';
  end if;

  if tg_op = 'UPDATE'
     and (new.pelicula_id is distinct from old.pelicula_id
          or new.inicio is distinct from old.inicio
          or new.sala_id is distinct from old.sala_id)
     and funcion_con_ventas(old.id) then
    if new.pelicula_id is distinct from old.pelicula_id then
      raise exception 'No se puede cambiar la película de una función con entradas vendidas';
    end if;
    raise exception 'No se puede cambiar el horario de una función con entradas vendidas';
  end if;

  if tg_op = 'UPDATE'
     and new.inicio is distinct from old.inicio
     and exists (select 1 from reservas r where r.funcion_id = old.id and r.expira_en > now()) then
    raise exception 'Hay personas eligiendo butacas para esta función, así que por ahora no se puede cambiar el horario. Probá de nuevo en unos minutos.';
  end if;

  if exists (select 1 from funciones f
              where f.sala_id = new.sala_id
                and f.id <> new.id
                and f.ocupacion && new.ocupacion) then
    select nombre into v_sala from salas where id = new.sala_id;
    raise exception 'Ya hay otra función en % en ese horario. Entre una función y la siguiente tiene que pasar media hora.',
      coalesce(v_sala, 'esa sala');
  end if;

  return new;
end $$;

create or replace function fn_funciones_proteger_ventas()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if funcion_con_ventas(old.id) then
    raise exception 'La función del % tiene entradas vendidas y no se puede eliminar. Para retirar la película, sacala de cartelera en lugar de borrarla.',
      to_char(old.inicio at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI');
  end if;
  return old;
end $$;

drop trigger if exists trg_funciones_proteger_ventas on funciones;
create trigger trg_funciones_proteger_ventas
  before delete on funciones
  for each row execute function fn_funciones_proteger_ventas();

create or replace function fn_peliculas_duracion()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_inicio timestamptz;
begin
  select f.inicio into v_inicio
    from funciones f
   where f.pelicula_id = new.id
     and f.inicio > now()
     and exists (select 1 from funciones o
                  where o.sala_id = f.sala_id
                    and o.id <> f.id
                    and o.ocupacion && tstzrange(f.inicio,
                                                 f.inicio + make_interval(mins => new.duracion_min) + interval '30 minutes',
                                                 '[)'))
   order by f.inicio
   limit 1;

  if found then
    raise exception 'Con la nueva duración, la función del % se superpone con otra de la misma sala. Reprogramala antes de cambiar la duración.',
      to_char(v_inicio at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI');
  end if;

  update funciones set fin = inicio + make_interval(mins => new.duracion_min)
   where pelicula_id = new.id and inicio > now();

  return new;
end $$;

drop trigger if exists trg_peliculas_duracion on peliculas;
create trigger trg_peliculas_duracion
  after update of duracion_min on peliculas
  for each row when (new.duracion_min is distinct from old.duracion_min)
  execute function fn_peliculas_duracion();

create or replace function fn_auditar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_id text;
  v_accion text;
  v_detalle jsonb;
  v_precio_viejo numeric;
  v_precio_nuevo numeric;
begin
  if tg_op = 'DELETE' then v_id := old.id::text; else v_id := new.id::text; end if;

  if tg_op = 'INSERT' then
    v_accion := 'crear';
    v_detalle := to_jsonb(new);
  elsif tg_op = 'DELETE' then
    v_accion := 'eliminar';
    v_detalle := to_jsonb(old);
  else
    v_accion := 'modificar';
    v_detalle := jsonb_build_object('antes', to_jsonb(old), 'despues', to_jsonb(new));

    if tg_table_name = 'funciones' then
      if new.precio_base is distinct from old.precio_base or new.precio_vip is distinct from old.precio_vip then
        v_accion := 'modificar_precio';
        v_detalle := v_detalle || jsonb_build_object(
          'precio_base_anterior', old.precio_base, 'precio_base_nuevo', new.precio_base,
          'precio_vip_anterior',  old.precio_vip,  'precio_vip_nuevo',  new.precio_vip);
      end if;
    elsif tg_table_name in ('productos','combos') then
      v_precio_viejo := old.precio; v_precio_nuevo := new.precio;
      if v_precio_nuevo is distinct from v_precio_viejo then
        v_accion := 'modificar_precio';
        v_detalle := jsonb_build_object('nombre', new.nombre,
          'precio_anterior', v_precio_viejo, 'precio_nuevo', v_precio_nuevo);
      end if;
    elsif tg_table_name = 'peliculas' then
      if new.precio_preventa is distinct from old.precio_preventa then
        v_accion := 'modificar_precio';
        v_detalle := jsonb_build_object('titulo', new.titulo,
          'preventa_anterior', old.precio_preventa, 'preventa_nuevo', new.precio_preventa);
      end if;
    elsif tg_table_name = 'cupones' then
      if new.porcentaje is distinct from old.porcentaje then
        v_accion := 'modificar_precio';
        v_detalle := jsonb_build_object('codigo', new.codigo,
          'porcentaje_anterior', old.porcentaje, 'porcentaje_nuevo', new.porcentaje);
      end if;
    elsif tg_table_name = 'recompensas' then
      if new.costo_puntos is distinct from old.costo_puntos then
        v_accion := 'modificar_precio';
        v_detalle := jsonb_build_object('nombre', new.nombre,
          'puntos_anterior', old.costo_puntos, 'puntos_nuevo', new.costo_puntos);
      end if;
    elsif tg_table_name = 'perfiles' then
      if new.rol is distinct from old.rol then
        v_accion := 'cambiar_rol';
        v_detalle := jsonb_build_object('email', new.email, 'rol_anterior', old.rol, 'rol_nuevo', new.rol);
      else
        return new;
      end if;
    end if;
  end if;

  insert into log_actividad (usuario_id, email, accion, entidad, entidad_id, detalle)
  values (auth.uid(), (select email from perfiles where id = auth.uid()),
          v_accion, tg_table_name, v_id, v_detalle);

  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

create or replace function fn_peliculas_estreno()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.en_cartelera then
    new.estreno_procesado := true;
  elsif tg_op = 'UPDATE'
        and new.fecha_estreno is distinct from old.fecha_estreno
        and new.fecha_estreno > hoy_local() then
    new.estreno_procesado := false;
  elsif tg_op = 'UPDATE' and old.en_cartelera then
    new.estreno_procesado := true;
  end if;
  return new;
end $$;

drop trigger if exists trg_peliculas_estreno on peliculas;
create trigger trg_peliculas_estreno
  before insert or update on peliculas
  for each row execute function fn_peliculas_estreno();

create or replace function fn_productos_proteger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from canjes where producto_id = old.id and not usado) then
    raise exception 'Ese producto tiene canjes pendientes: desactivalo en lugar de borrarlo';
  end if;
  if exists (select 1 from recompensas where producto_id = old.id and activo) then
    raise exception 'Ese producto es parte de una recompensa activa: desactivalo en lugar de borrarlo, o primero desactivá la recompensa';
  end if;
  return old;
end $$;

drop trigger if exists trg_productos_proteger on productos;
create trigger trg_productos_proteger
  before delete on productos
  for each row execute function fn_productos_proteger();

create or replace function fn_resenias_estreno()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from peliculas p
     where p.id = new.pelicula_id
       and (p.en_cartelera
            or (p.fecha_estreno is not null and p.fecha_estreno <= hoy_local())
            or exists (select 1 from funciones f where f.pelicula_id = p.id and f.inicio <= now()))) then
    raise exception 'Solo se pueden reseñar películas que ya se estrenaron';
  end if;
  return new;
end $$;

drop trigger if exists trg_resenias_estreno on resenias;
create trigger trg_resenias_estreno
  before insert or update of pelicula_id on resenias
  for each row execute function fn_resenias_estreno();

drop function if exists reservar_butacas(bigint, bigint[], text);

create function reservar_butacas(p_funcion_id bigint, p_butacas bigint[], p_sesion text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_f funciones;
  v_huella text;
  v_butacas bigint[];
  v_cant int;
  v_etiquetas text[];
  v_vence timestamptz;
  v_guardadas int;
begin
  if coalesce(trim(p_sesion), '') = '' then
    raise exception 'La sesión de reserva no es válida';
  end if;
  v_huella := huella_de_sesion(p_sesion);

  select coalesce(array_agg(distinct b), '{}') into v_butacas
    from unnest(coalesce(p_butacas, '{}'::bigint[])) b
   where b is not null;
  v_cant := coalesce(array_length(v_butacas, 1), 0);

  if v_cant > 10 then
    raise exception 'Podés elegir hasta 10 butacas por compra';
  end if;

  if v_cant = 0 then
    perform 1 from reservas where sesion = v_huella order by id for update;
    delete from reservas where sesion = v_huella;
    return 0;
  end if;

  perform pg_advisory_xact_lock(p_funcion_id);
  perform 1 from reservas where sesion = v_huella order by id for update;

  select * into v_f from funciones where id = p_funcion_id;
  if not found then raise exception 'La función no existe'; end if;
  if v_f.inicio <= now() then raise exception 'La función ya comenzó'; end if;
  if not venta_abierta(v_f.pelicula_id) then
    raise exception 'La venta de entradas para esta película todavía no está abierta';
  end if;

  if exists (select 1 from unnest(v_butacas) b
              where not exists (select 1 from butacas x where x.id = b and x.sala_id = v_f.sala_id)) then
    raise exception 'Alguna butaca no pertenece a la sala de esta función';
  end if;

  select array_agg(x.fila || x.numero order by x.fila, x.numero) into v_etiquetas
    from butacas x
   where x.id = any(v_butacas)
     and exists (select 1 from entradas e
                  where e.funcion_id = p_funcion_id and e.butaca_id = x.id and e.activa);
  if array_length(v_etiquetas, 1) = 1 then
    raise exception 'La butaca % ya se vendió', v_etiquetas[1];
  elsif array_length(v_etiquetas, 1) > 1 then
    raise exception 'Las butacas % ya se vendieron', array_to_string(v_etiquetas, ', ');
  end if;

  select array_agg(x.fila || x.numero order by x.fila, x.numero) into v_etiquetas
    from butacas x
   where x.id = any(v_butacas)
     and exists (select 1 from reservas r
                  where r.funcion_id = p_funcion_id and r.butaca_id = x.id
                    and r.expira_en > now() and r.sesion <> v_huella);
  if array_length(v_etiquetas, 1) = 1 then
    raise exception 'Otra persona está eligiendo la butaca %', v_etiquetas[1];
  elsif array_length(v_etiquetas, 1) > 1 then
    raise exception 'Otra persona está eligiendo las butacas %', array_to_string(v_etiquetas, ', ');
  end if;

  delete from reservas
   where id in (select id from reservas
                 where funcion_id = p_funcion_id and expira_en <= now()
                 for update skip locked);
  delete from reservas where sesion = v_huella and funcion_id <> p_funcion_id;

  select min(r.expira_en) into v_vence
    from reservas r
   where r.sesion = v_huella and r.funcion_id = p_funcion_id;
  v_vence := coalesce(v_vence, now() + interval '8 minutes');

  delete from reservas
   where sesion = v_huella and funcion_id = p_funcion_id and butaca_id <> all(v_butacas);

  insert into reservas (funcion_id, butaca_id, sesion, expira_en)
  select p_funcion_id, b, v_huella, v_vence from unnest(v_butacas) b
  on conflict (funcion_id, butaca_id) do update
     set sesion = excluded.sesion, expira_en = excluded.expira_en
   where reservas.sesion = excluded.sesion or reservas.expira_en <= now();
  get diagnostics v_guardadas = row_count;

  if v_guardadas <> v_cant then
    raise exception 'Otra persona está eligiendo alguna de esas butacas';
  end if;

  return greatest(0, ceil(extract(epoch from v_vence - now())))::int;
end $$;

create or replace function butacas_estado(p_funcion_id bigint, p_sesion text default '')
returns table (butaca_id bigint, estado text)
language sql stable security definer set search_path = public as $$
  select e.butaca_id, 'vendida'::text
    from entradas e
   where e.funcion_id = p_funcion_id and e.activa
  union all
  select r.butaca_id, 'reservada'::text
    from reservas r
   where r.funcion_id = p_funcion_id
     and r.expira_en > now()
     and r.sesion is distinct from huella_de_sesion(p_sesion)
     and not exists (select 1 from entradas e
                      where e.funcion_id = r.funcion_id and e.butaca_id = r.butaca_id and e.activa);
$$;

create or replace function registrar_compra(
  p_funcion_id bigint,
  p_butacas bigint[],
  p_items jsonb default '[]'::jsonb,
  p_email text default null,
  p_cupon_codigo text default null,
  p_usar_credito numeric default 0,
  p_fecha_nacimiento date default null,
  p_sesion text default null,
  p_canjes text[] default null,
  p_medio_pago text default null,
  p_tarjeta_marca text default null,
  p_tarjeta_ultimos4 text default null,
  p_total_esperado numeric default null)
returns compras language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_perfil perfiles;
  v_f funciones;
  v_p peliculas;
  v_edad int;
  v_precio_est numeric; v_precio_vip numeric;
  v_sub numeric := 0; v_sub_entradas numeric := 0; v_canje numeric := 0; v_combos numeric := 0;
  v_desc numeric := 0; v_cred numeric := 0; v_total numeric;
  v_producto_id bigint; v_combo_id bigint; v_unidades int; v_incluidas int;
  v_nombre_item text; v_precio_item numeric;
  v_cupon cupones;
  v_compra compras;
  v_codigo text;
  v_email text;
  v_huella text := case when coalesce(trim(p_sesion), '') = '' then null else huella_de_sesion(p_sesion) end;
  v_b record;
  v_item jsonb;
  v_nac date;
  v_cant int;
  v_pedidos text[];
  v_codigos text[] := '{}';
  v_cj canjes;
  v_entradas_canje int := 0;
  v_entradas_combo int := 0;
  v_prod productos;
  v_medio medio_pago;
begin
  if p_funcion_id is null then raise exception 'Falta indicar la función'; end if;
  v_cant := coalesce(array_length(p_butacas,1),0);
  if v_cant = 0 then raise exception 'Seleccioná al menos una butaca'; end if;
  if v_cant > 10 then raise exception 'Podés elegir hasta 10 butacas por compra'; end if;
  if (select count(distinct b) from unnest(p_butacas) b) <> v_cant then
    raise exception 'Hay butacas repetidas en la selección';
  end if;

  select * into v_f from funciones where id = p_funcion_id;
  if not found then raise exception 'La función no existe'; end if;
  if v_f.inicio <= now() then raise exception 'La función ya comenzó'; end if;

  select * into v_p from peliculas where id = v_f.pelicula_id;

  if not venta_abierta(v_p.id) then
    raise exception 'La venta de entradas para esta película todavía no está abierta';
  end if;

  perform pg_advisory_xact_lock(p_funcion_id);
  if v_huella is not null then
    perform 1 from reservas where sesion = v_huella order by id for update;
  end if;

  if exists (select 1 from reservas r
              where r.funcion_id = p_funcion_id
                and r.butaca_id = any(p_butacas)
                and r.expira_en > now()
                and r.sesion is distinct from v_huella) then
    raise exception 'Una de las butacas está reservada por otra persona. Actualizá el mapa y elegí otra.';
  end if;

  if v_uid is not null then
    select * into v_perfil from perfiles where id = v_uid for update;
    if not found then
      raise exception 'No encontramos los datos de tu cuenta. Escribinos para que lo revisemos.';
    end if;
  end if;

  v_email := nullif(trim(coalesce(p_email, '')), '');
  if v_email is not null and v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s.]{2,}$' then
    v_email := null;
  end if;
  if v_uid is null and v_email is null then
    raise exception 'Ingresá un email válido para recibir tus entradas';
  end if;
  v_email := coalesce(v_email, v_perfil.email);

  v_nac := coalesce(v_perfil.fecha_nacimiento, p_fecha_nacimiento);

  if v_p.restriccion_edad > 0 then
    if v_nac is null then
      raise exception 'Necesitamos tu fecha de nacimiento para esta película';
    end if;
    v_edad := extract(year from age(hoy_local(), v_nac))::int;
    if v_edad < v_p.restriccion_edad then
      raise exception 'No cumplís la edad mínima (+%) para esta película', v_p.restriccion_edad;
    end if;
  end if;

  if preventa_vigente(v_p.id) then
    v_precio_est := v_p.precio_preventa;
    v_precio_vip := round(v_p.precio_preventa * 1.5, 2);
  else
    v_precio_est := v_f.precio_base;
    v_precio_vip := v_f.precio_vip;
  end if;

  select coalesce(array_agg(distinct upper(trim(x))), '{}')
    into v_pedidos
    from unnest(coalesce(p_canjes, '{}'::text[])) x
   where trim(x) <> '';

  if array_length(v_pedidos, 1) > 0 then
    if v_uid is null then raise exception 'Los canjes son solo para usuarios registrados'; end if;

    for v_cj in
      select c.* from canjes c where c.codigo = any(v_pedidos) for update
    loop
      if v_cj.usuario_id <> v_uid then raise exception 'El canje % no pertenece a tu cuenta', v_cj.codigo; end if;
      if v_cj.usado then raise exception 'El canje % ya fue usado', v_cj.codigo; end if;
      v_codigos := v_codigos || v_cj.codigo;
      if v_cj.tipo = 'entrada' then
        v_entradas_canje := v_entradas_canje + 1;
      end if;
    end loop;

    if coalesce(array_length(v_codigos,1),0) <> array_length(v_pedidos,1) then
      raise exception 'Alguno de los canjes no existe';
    end if;

    if v_entradas_canje > v_cant then
      raise exception 'Tenés más canjes de entrada que butacas elegidas';
    end if;
  end if;

  v_codigo := substr(upper(replace(gen_random_uuid()::text, '-', '')), 1, 12);

  insert into compras (usuario_id, email_contacto, codigo, funcion_id)
  values (v_uid, v_email, v_codigo, p_funcion_id)
  returning * into v_compra;

  for v_b in
    select b.id, b.tipo from butacas b
    where b.id = any(p_butacas) and b.sala_id = v_f.sala_id
  loop
    begin
      insert into entradas (compra_id, funcion_id, butaca_id, precio)
      values (v_compra.id, p_funcion_id, v_b.id,
              case when v_b.tipo = 'vip' then v_precio_vip else v_precio_est end);
    exception when unique_violation then
      raise exception 'Una de las butacas elegidas acaba de venderse. Actualizá el mapa.';
    end;
    v_sub_entradas := v_sub_entradas + case when v_b.tipo = 'vip' then v_precio_vip else v_precio_est end;
  end loop;

  v_sub := v_sub_entradas;

  if (select count(*) from entradas where compra_id = v_compra.id) <> v_cant then
    raise exception 'Alguna butaca no pertenece a la sala de esta función';
  end if;

  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    for v_item in select * from jsonb_array_elements(p_items) loop
      v_producto_id := nullif(v_item->>'producto_id','')::bigint;
      v_combo_id    := nullif(v_item->>'combo_id','')::bigint;
      v_unidades    := coalesce((v_item->>'cantidad')::int, 1);

      if (v_producto_id is null) = (v_combo_id is null) then
        raise exception 'Hay un producto inválido en el pedido';
      end if;
      if v_unidades < 1 or v_unidades > 20 then
        raise exception 'Cada producto se puede pedir entre 1 y 20 unidades';
      end if;

      if v_producto_id is not null then
        select nombre, precio, 0 into v_nombre_item, v_precio_item, v_incluidas
          from productos where id = v_producto_id and activo;
      else
        select nombre, precio, entradas_incluidas into v_nombre_item, v_precio_item, v_incluidas
          from combos where id = v_combo_id and activo;
      end if;
      if not found then
        raise exception 'Uno de los productos del pedido ya no está disponible';
      end if;

      insert into compra_items (compra_id, producto_id, combo_id, nombre, cantidad, precio_unitario)
      values (v_compra.id, v_producto_id, v_combo_id, v_nombre_item, v_unidades, v_precio_item);
      v_sub := v_sub + v_unidades * v_precio_item;
      v_entradas_combo := v_entradas_combo + v_unidades * coalesce(v_incluidas, 0);
    end loop;
  end if;

  if v_entradas_canje + v_entradas_combo > v_cant then
    raise exception 'Tus combos y canjes incluyen más entradas que las butacas elegidas';
  end if;

  for v_cj in select c.* from canjes c where c.codigo = any(v_codigos) and c.tipo = 'producto' loop
    select * into v_prod from productos where id = v_cj.producto_id;
    if not found then raise exception 'El producto del canje % ya no existe', v_cj.codigo; end if;
    insert into compra_items (compra_id, producto_id, nombre, cantidad, precio_unitario)
    values (v_compra.id, v_prod.id, v_prod.nombre || ' (canje)', 1, 0);
  end loop;

  v_canje := least(v_entradas_canje * v_precio_est, v_sub_entradas);
  v_combos := least(v_entradas_combo * v_precio_est, v_sub_entradas - v_canje);

  if p_cupon_codigo is not null and length(trim(p_cupon_codigo)) > 0 then
    select * into v_cupon from cupones
     where upper(codigo) = upper(trim(p_cupon_codigo)) and activo;
    if not found then raise exception 'El cupón no es válido'; end if;
    if v_uid is null then raise exception 'Los cupones son solo para usuarios registrados'; end if;
    if v_cupon.tipo = 'bienvenida' then
      if v_perfil.cupon_bienvenida_usado then
        raise exception 'Ya usaste el cupón de bienvenida';
      end if;
      if exists (select 1 from compras c
                  where c.usuario_id = v_uid and c.estado = 'pagada' and c.id <> v_compra.id) then
        raise exception 'El cupón de bienvenida es solo para tu primera compra';
      end if;
    end if;
    if v_cupon.tipo = 'edad' then
      if v_nac is null or extract(year from age(hoy_local(), v_nac))::int < coalesce(v_cupon.edad_minima, 0) then
        raise exception 'Este cupón no aplica a tu edad';
      end if;
    end if;
    v_desc := round((v_sub - v_canje - v_combos) * v_cupon.porcentaje / 100, 2);
  end if;

  v_total := greatest(0, round(v_sub - v_canje - v_combos - v_desc, 2));

  if coalesce(p_usar_credito,0) > 0 then
    if v_uid is null then raise exception 'El crédito es solo para usuarios registrados'; end if;
    v_cred := round(least(p_usar_credito, v_perfil.credito, v_total), 2);
    v_total := greatest(0, round(v_total - v_cred, 2));
  end if;

  if p_total_esperado is not null and round(p_total_esperado, 2) <> v_total then
    raise exception 'El total cambió mientras pagabas. Revisá el resumen de tu compra y volvé a intentar.';
  end if;

  if v_total > 0 then
    if p_medio_pago is null or p_medio_pago not in ('tarjeta_credito','tarjeta_debito','mercado_pago') then
      raise exception 'Elegí un medio de pago para completar la compra';
    end if;
    v_medio := p_medio_pago::medio_pago;
    if v_medio in ('tarjeta_credito','tarjeta_debito')
       and (coalesce(p_tarjeta_ultimos4,'') !~ '^[0-9]{4}$' or coalesce(trim(p_tarjeta_marca),'') = '') then
      raise exception 'Faltan los datos de la tarjeta';
    end if;
  else
    v_medio := 'sin_cargo';
  end if;

  update compras
     set subtotal = v_sub, descuento = v_desc, descuento_canjes = v_canje, descuento_combos = v_combos,
         credito_usado = v_cred, total = v_total,
         cupon_id = case when v_desc > 0 then v_cupon.id end,
         medio_pago = v_medio,
         tarjeta_marca = case when v_medio in ('tarjeta_credito','tarjeta_debito') then trim(p_tarjeta_marca) end,
         tarjeta_ultimos4 = case when v_medio in ('tarjeta_credito','tarjeta_debito') then p_tarjeta_ultimos4 end,
         puntos_ganados = case when v_uid is null then 0 else floor(v_total)::int end
   where id = v_compra.id
  returning * into v_compra;

  if array_length(v_codigos, 1) > 0 then
    update canjes set usado = true, usado_en = now(), compra_id = v_compra.id
     where codigo = any(v_codigos);
  end if;

  if v_uid is not null then
    perform set_config('app.bypass_perfil','on',true);
    update perfiles
       set credito = credito - v_cred,
           puntos  = puntos + v_compra.puntos_ganados,
           cupon_bienvenida_usado = cupon_bienvenida_usado
                                    or (coalesce(v_cupon.tipo = 'bienvenida', false) and v_desc > 0)
     where id = v_uid;
  end if;

  delete from reservas where funcion_id = p_funcion_id and butaca_id = any(p_butacas);
  if v_huella is not null then delete from reservas where sesion = v_huella; end if;

  begin
    perform correo_de_compra(v_compra.id);
  exception when others then
    raise warning 'No se pudo preparar el correo de la compra %: %', v_compra.id, sqlerrm;
  end;

  return v_compra;
end $$;

create or replace function cancelar_compra(p_compra_id bigint)
returns compras language plpgsql security definer set search_path = public as $$
declare v_c compras; v_f funciones; v_puntos int; v_bienvenida boolean;
begin
  if auth.uid() is null then
    raise exception 'Tenés que iniciar sesión para cancelar una compra';
  end if;

  select * into v_c from compras where id = p_compra_id for update;
  if not found then raise exception 'La compra no existe'; end if;
  if not es_admin() and (v_c.usuario_id is null or v_c.usuario_id <> auth.uid()) then
    raise exception 'No podés cancelar esta compra';
  end if;
  if v_c.estado = 'cancelada' then raise exception 'La compra ya estaba cancelada'; end if;
  if v_c.entrada_validada then raise exception 'La entrada ya fue utilizada'; end if;
  if v_c.productos_entregados then raise exception 'Los productos del candy bar ya fueron entregados'; end if;

  select * into v_f from funciones where id = v_c.funcion_id;
  if v_f.id is not null and v_f.inicio - now() < interval '2 hours' then
    raise exception 'Solo se puede cancelar hasta 2 horas antes de la función';
  end if;

  if v_c.usuario_id is not null and v_c.puntos_ganados > 0 then
    select puntos into v_puntos from perfiles where id = v_c.usuario_id for update;
    if coalesce(v_puntos, 0) < v_c.puntos_ganados then
      raise exception 'Ya usaste los puntos que sumaste con esta compra, por eso no se puede cancelar';
    end if;
  end if;

  v_bienvenida := exists (select 1 from cupones cu where cu.id = v_c.cupon_id and cu.tipo = 'bienvenida');

  update entradas set activa = false where compra_id = v_c.id;
  update canjes set usado = false, usado_en = null, compra_id = null where compra_id = v_c.id;
  update compras set estado = 'cancelada' where id = v_c.id returning * into v_c;

  if v_c.usuario_id is not null then
    perform set_config('app.bypass_perfil','on',true);
    update perfiles
       set credito = credito + v_c.total + v_c.credito_usado,
           puntos  = puntos - v_c.puntos_ganados,
           cupon_bienvenida_usado = case when v_bienvenida then false else cupon_bienvenida_usado end
     where id = v_c.usuario_id;
  end if;

  perform registrar_log('cancelar', 'compra', v_c.id::text, jsonb_build_object('codigo', v_c.codigo));
  return v_c;
end $$;

create or replace function validar_qr(p_codigo text, p_tipo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c compras; v_f funciones; v_p peliculas;
begin
  if not es_empleado() then raise exception 'No autorizado'; end if;

  select * into v_c from compras where upper(codigo) = upper(trim(p_codigo)) for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'El código no existe'); end if;
  if v_c.estado = 'cancelada' then return jsonb_build_object('ok', false, 'motivo', 'La compra fue cancelada'); end if;

  select * into v_f from funciones where id = v_c.funcion_id;

  if p_tipo = 'entrada' then
    if v_c.funcion_id is null then return jsonb_build_object('ok', false, 'motivo', 'La compra no incluye entradas'); end if;
    if v_c.entrada_validada then return jsonb_build_object('ok', false, 'motivo', 'La entrada ya fue utilizada'); end if;
    if now() > v_f.fin then return jsonb_build_object('ok', false, 'motivo', 'La función ya terminó'); end if;
    if (v_f.inicio at time zone 'America/Argentina/Buenos_Aires')::date > hoy_local() then
      return jsonb_build_object('ok', false, 'motivo',
        'La entrada es para el ' || to_char(v_f.inicio at time zone 'America/Argentina/Buenos_Aires', 'DD/MM "a las" HH24:MI'));
    end if;
    update compras set entrada_validada = true, entrada_validada_en = now() where id = v_c.id;
  elsif p_tipo = 'candy' then
    if not exists (select 1 from compra_items where compra_id = v_c.id) then
      return jsonb_build_object('ok', false, 'motivo', 'La compra no incluye productos');
    end if;
    if v_c.productos_entregados then return jsonb_build_object('ok', false, 'motivo', 'Los productos ya fueron entregados'); end if;
    if v_f.id is not null and (v_f.inicio at time zone 'America/Argentina/Buenos_Aires')::date > hoy_local() then
      return jsonb_build_object('ok', false, 'motivo',
        'El pedido es para la función del ' || to_char(v_f.inicio at time zone 'America/Argentina/Buenos_Aires', 'DD/MM "a las" HH24:MI'));
    end if;
    update compras set productos_entregados = true, productos_entregados_en = now() where id = v_c.id;
    update compra_items set entregado = true where compra_id = v_c.id;
  else
    raise exception 'Tipo de validación inválido';
  end if;

  perform registrar_log('validar_qr', 'compra', v_c.id::text,
    jsonb_build_object('tipo', p_tipo, 'codigo', v_c.codigo));

  select * into v_c from compras where id = v_c.id;
  select * into v_f from funciones where id = v_c.funcion_id;
  select * into v_p from peliculas where id = v_f.pelicula_id;

  return jsonb_build_object(
    'ok', true,
    'codigo', v_c.codigo,
    'pelicula', coalesce(v_p.titulo, ''),
    'inicio', v_f.inicio,
    'sala', (select nombre from salas where id = v_f.sala_id),
    'butacas', coalesce((select jsonb_agg(b.fila || b.numero order by b.fila, b.numero)
                           from entradas e join butacas b on b.id = e.butaca_id
                          where e.compra_id = v_c.id and e.activa), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('nombre', ci.nombre, 'cantidad', ci.cantidad))
                         from compra_items ci where ci.compra_id = v_c.id), '[]'::jsonb)
  );
end $$;

create or replace function buscar_compra(p_codigo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c compras; v_f funciones; v_p peliculas;
begin
  select * into v_c from compras where upper(codigo) = upper(trim(p_codigo));
  if not found then return null; end if;
  select * into v_f from funciones where id = v_c.funcion_id;
  select * into v_p from peliculas where id = v_f.pelicula_id;
  return jsonb_build_object(
    'compra', (to_jsonb(v_c) - 'usuario_id') || jsonb_build_object('email_contacto', enmascarar_email(v_c.email_contacto)),
    'pelicula', to_jsonb(v_p),
    'funcion', to_jsonb(v_f),
    'sala', (select nombre from salas where id = v_f.sala_id),
    'butacas', coalesce((select jsonb_agg(jsonb_build_object('etiqueta', b.fila || b.numero, 'tipo', b.tipo) order by b.fila, b.numero)
                           from entradas e join butacas b on b.id = e.butaca_id
                          where e.compra_id = v_c.id and e.activa), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('nombre', ci.nombre, 'cantidad', ci.cantidad, 'precio_unitario', ci.precio_unitario))
                         from compra_items ci where ci.compra_id = v_c.id), '[]'::jsonb)
  );
end $$;

create or replace function mis_peliculas()
returns table (pelicula_id bigint, titulo text, imagen_url text, vista_en timestamptz, estrellas int)
language sql stable security definer set search_path = public as $$
  select p.id, p.titulo, p.imagen_url, f.inicio,
         (select r.estrellas from resenias r where r.pelicula_id = p.id and r.usuario_id = auth.uid())
    from funciones f
    join peliculas p on p.id = f.pelicula_id
   where f.inicio < now()
     and exists (select 1 from compras c
                  where c.funcion_id = f.id and c.usuario_id = auth.uid() and c.estado = 'pagada')
   order by f.inicio desc, p.id;
$$;

create or replace function peliculas_mas_vistas(p_agrupacion text default 'semana')
returns table (periodo text, titulo text, vistas bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_unidad text := case when p_agrupacion = 'mes' then 'month' else 'week' end;
begin
  if not es_admin() then raise exception 'No autorizado'; end if;
  return query
    select to_char(date_trunc(v_unidad, f.inicio at time zone 'America/Argentina/Buenos_Aires'), 'YYYY-MM-DD'),
           p.titulo,
           count(e.id)::bigint
      from entradas e
      join compras   c on c.id = e.compra_id
      join funciones f on f.id = e.funcion_id
      join peliculas p on p.id = f.pelicula_id
     where e.activa and c.estado = 'pagada' and f.inicio < now()
     group by 1, 2
     order by 1 desc, 3 desc, 2
     limit 40;
end $$;

create or replace function reporte_facturacion(p_desde date, p_hasta date)
returns table (dia date, compras bigint, entradas bigint, productos bigint, facturado numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'No autorizado'; end if;
  return query
    select (c.creado_en at time zone 'America/Argentina/Buenos_Aires')::date,
           count(distinct c.id)::bigint,
           coalesce(sum((select count(*) from entradas e where e.compra_id = c.id and e.activa)),0)::bigint,
           coalesce(sum((select coalesce(sum(ci.cantidad),0) from compra_items ci where ci.compra_id = c.id)),0)::bigint,
           coalesce(sum(c.total + c.credito_usado),0)
      from compras c
     where c.estado = 'pagada'
       and (c.creado_en at time zone 'America/Argentina/Buenos_Aires')::date between p_desde and p_hasta
     group by 1 order by 1;
end $$;

create or replace function estadisticas_admin()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_hoy date := hoy_local();
  v_desde_mes timestamptz := date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires')
                             at time zone 'America/Argentina/Buenos_Aires';
begin
  if not es_admin() then raise exception 'No autorizado'; end if;
  return jsonb_build_object(
    'facturado_hoy',  (select coalesce(sum(total + credito_usado),0) from compras
                        where estado = 'pagada'
                          and (creado_en at time zone 'America/Argentina/Buenos_Aires')::date = v_hoy),
    'entradas_hoy',   (select count(*) from entradas e join compras c on c.id = e.compra_id
                        where e.activa and c.estado = 'pagada'
                          and (c.creado_en at time zone 'America/Argentina/Buenos_Aires')::date = v_hoy),
    'facturado_mes',  (select coalesce(sum(total + credito_usado),0) from compras
                        where estado = 'pagada' and creado_en >= v_desde_mes),
    'usuarios',       (select count(*) from perfiles),
    'peliculas',      (select count(*) from peliculas where en_cartelera),
    'funciones_hoy',  (select count(*) from funciones
                        where (inicio at time zone 'America/Argentina/Buenos_Aires')::date = v_hoy)
  );
end $$;

create or replace function resenias_de_pelicula(p_pelicula_id bigint)
returns table (id bigint, pelicula_id bigint, usuario_id uuid, estrellas int, comentario text, creado_en timestamptz, autor text)
language sql stable security definer set search_path = public as $$
  select r.id, r.pelicula_id, r.usuario_id, r.estrellas, r.comentario, r.creado_en,
         case
           when coalesce(trim(pf.nombre), '') = '' then 'Usuario'
           else trim(pf.nombre)
                || case when coalesce(trim(pf.apellido), '') = '' then ''
                        else ' ' || upper(left(trim(pf.apellido), 1)) || '.' end
         end
    from resenias r
    left join perfiles pf on pf.id = r.usuario_id
   where r.pelicula_id = p_pelicula_id
   order by r.creado_en desc, r.id desc;
$$;

create or replace function descripcion_medio_pago(p_compra compras)
returns text language sql immutable as $$
  select case p_compra.medio_pago
    when 'tarjeta_credito' then 'Tarjeta de crédito ' || escapar_html(coalesce(p_compra.tarjeta_marca, '')) || ' terminada en ' || coalesce(p_compra.tarjeta_ultimos4, '----')
    when 'tarjeta_debito'  then 'Tarjeta de débito '  || escapar_html(coalesce(p_compra.tarjeta_marca, '')) || ' terminada en ' || coalesce(p_compra.tarjeta_ultimos4, '----')
    when 'mercado_pago'    then 'Mercado Pago'
    when 'sin_cargo'       then 'Sin cargo'
    else 'No registrado'
  end;
$$;

drop function if exists enviar_correo(text, text, text, text);

create function enviar_correo(
  p_destinatario text, p_asunto text, p_html text, p_motivo text)
returns boolean language plpgsql security definer
set search_path = public, extensions, net, pg_temp as $$
declare
  v_clave     text := valor_de_configuracion('brevo_api_key');
  v_remitente text := valor_de_configuracion('correo_remitente');
  v_nombre    text := coalesce(valor_de_configuracion('nombre_remitente'), 'CineNova');
  v_asunto    text := coalesce(nullif(trim(p_asunto), ''), 'CineNova');
  v_motivo    text := coalesce(nullif(trim(p_motivo), ''), 'otro');
  v_esquema   text;
  v_pedido    bigint;
begin
  if p_destinatario is null or position('@' in p_destinatario) < 2 then
    return false;
  end if;

  if v_clave is null or v_remitente is null then
    insert into correos (destinatario, asunto, motivo, estado, detalle)
    values (p_destinatario, v_asunto, v_motivo, 'sin_configurar',
            'Falta cargar brevo_api_key o correo_remitente en la tabla configuracion.');
    return false;
  end if;

  select n.nspname into v_esquema
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'http_post' and n.nspname in ('net','extensions') and p.pronargs >= 4
   order by (n.nspname = 'net') desc limit 1;

  if v_esquema is null then
    insert into correos (destinatario, asunto, motivo, estado, detalle)
    values (p_destinatario, v_asunto, v_motivo, 'fallido', 'La extensión pg_net no está disponible.');
    return false;
  end if;

  execute format('select %I.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := $4)', v_esquema)
     into v_pedido
    using
      'https://api.brevo.com/v3/smtp/email',
      jsonb_build_object(
        'sender',      jsonb_build_object('name', v_nombre, 'email', v_remitente),
        'to',          jsonb_build_array(jsonb_build_object('email', p_destinatario)),
        'subject',     v_asunto,
        'htmlContent', p_html),
      jsonb_build_object('Content-Type','application/json','api-key',v_clave,'accept','application/json'),
      8000;

  insert into correos (destinatario, asunto, motivo, estado, detalle, pedido_http)
  values (p_destinatario, v_asunto, v_motivo, 'enviado', null, v_pedido);
  return true;

exception when others then
  insert into correos (destinatario, asunto, motivo, estado, detalle)
  values (p_destinatario, v_asunto, v_motivo, 'fallido', sqlerrm);
  return false;
end $$;

create or replace function conciliar_correos()
returns void language plpgsql security definer set search_path = public as $$
begin
  if to_regclass('net._http_response') is null then
    return;
  end if;
  execute $consulta$
    update public.correos c
       set estado = 'fallido',
           detalle = left(coalesce(nullif(r.error_msg, ''),
                                   'Brevo respondió ' || coalesce(r.status_code::text, 'sin código') || ': ' || coalesce(r.content, '')),
                          1000)
      from net._http_response r
     where r.id = c.pedido_http
       and c.estado = 'enviado'
       and (r.status_code is null or r.status_code not between 200 and 299)
  $consulta$;
exception when others then
  raise warning 'No se pudo conciliar el estado de los correos: %', sqlerrm;
end $$;

create or replace function correo_de_compra(p_compra_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_c compras; v_f funciones; v_p peliculas; v_sala text;
  v_butacas text; v_items text; v_cuerpo text; v_url text; v_titulo text;
  v_fila record;
begin
  select * into v_c from compras where id = p_compra_id;
  if not found or v_c.estado <> 'pagada' then return; end if;

  select * into v_f from funciones where id = v_c.funcion_id;
  select * into v_p from peliculas where id = v_f.pelicula_id;
  select nombre into v_sala from salas where id = v_f.sala_id;
  v_titulo := coalesce(v_p.titulo, 'tu función');

  select string_agg(b.fila || b.numero ||
           case b.tipo when 'vip' then ' (VIP)' when 'accesible' then ' (accesible)' else '' end,
           ', ' order by b.fila, b.numero)
    into v_butacas
    from entradas e join butacas b on b.id = e.butaca_id
   where e.compra_id = v_c.id and e.activa;

  v_items := '';
  for v_fila in select nombre, cantidad from compra_items where compra_id = v_c.id order by id loop
    v_items := v_items || '<tr><td style="padding:6px 0;font:400 14px Helvetica,Arial,sans-serif;color:#a8adbd;">'
            || v_fila.cantidad || ' &times; ' || escapar_html(v_fila.nombre) || '</td></tr>';
  end loop;

  v_url := coalesce(valor_de_configuracion('url_app'), '') || '/compra/' || v_c.codigo;

  v_cuerpo :=
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1a1d28;border-radius:12px;padding:20px 22px;">'
    || '<tr><td style="font:700 19px Helvetica,Arial,sans-serif;color:#f2f3f7;padding-bottom:14px;">' || escapar_html(v_titulo) || '</td></tr>'
    || '<tr><td style="font:400 14px/1.9 Helvetica,Arial,sans-serif;color:#a8adbd;">'
    || '<strong style="color:#f2f3f7;">Función:</strong> '
    || coalesce(to_char(v_f.inicio at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY') || ' a las '
       || to_char(v_f.inicio at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI') || ' h', 'A confirmar') || '<br>'
    || '<strong style="color:#f2f3f7;">Sala:</strong> ' || escapar_html(coalesce(v_sala, 'A confirmar'))
    || coalesce(' &middot; ' || v_f.formato || ' &middot; ' || initcap(v_f.idioma::text), '') || '<br>'
    || '<strong style="color:#f2f3f7;">Butacas:</strong> ' || escapar_html(coalesce(v_butacas, '-'))
    || '</td></tr></table>'
    || case when v_items = '' then ''
       else '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;background:#1a1d28;border-radius:12px;padding:16px 22px;">'
            || '<tr><td style="font:700 12px Helvetica,Arial,sans-serif;color:#f5b43c;letter-spacing:1px;padding-bottom:6px;">CANDY BAR</td></tr>'
            || v_items || '</table>' end
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;">'
    || linea_correo('Subtotal', formato_pesos(v_c.subtotal))
    || case when v_c.descuento_canjes > 0 then linea_correo('Canje de puntos', '&minus; ' || formato_pesos(v_c.descuento_canjes), '#3fcf8e') else '' end
    || case when v_c.descuento_combos > 0 then linea_correo('Entradas incluidas en combos', '&minus; ' || formato_pesos(v_c.descuento_combos), '#3fcf8e') else '' end
    || case when v_c.descuento > 0 then linea_correo('Cupón de descuento', '&minus; ' || formato_pesos(v_c.descuento), '#3fcf8e') else '' end
    || case when v_c.credito_usado > 0 then linea_correo('Crédito usado', '&minus; ' || formato_pesos(v_c.credito_usado), '#3fcf8e') else '' end
    || '<tr><td style="font:700 15px Helvetica,Arial,sans-serif;color:#f2f3f7;padding:10px 0 4px;border-top:1px solid #2a2f40;">Total abonado</td>'
    || '<td align="right" style="font:700 19px Helvetica,Arial,sans-serif;color:#f5b43c;padding:10px 0 4px;border-top:1px solid #2a2f40;">' || formato_pesos(v_c.total) || '</td></tr>'
    || linea_correo('Medio de pago', descripcion_medio_pago(v_c), '#f2f3f7')
    || case when v_c.puntos_ganados > 0 then linea_correo('Puntos sumados', v_c.puntos_ganados::text, '#ffd27f') else '' end
    || '</table>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;background:#0a0b10;border:1px dashed #2a2f40;border-radius:12px;padding:18px;">'
    || '<tr><td align="center">'
    || '<div style="font:700 11px Helvetica,Arial,sans-serif;color:#6b7185;letter-spacing:2px;">CÓDIGO DE COMPRA</div>'
    || '<div style="font:700 24px/1.6 Courier New,monospace;color:#f5b43c;letter-spacing:4px;">' || escapar_html(v_c.codigo) || '</div>'
    || '<div style="font:400 13px/1.6 Helvetica,Arial,sans-serif;color:#a8adbd;">Mostrá el código QR desde el enlace de abajo para ingresar a la sala y retirar tu pedido del candy bar. Cada uno se valida una sola vez y la entrada sirve solo el día de la función.</div>'
    || '</td></tr></table>'
    || case when coalesce(v_p.restriccion_edad, 0) > 0
       then '<p style="margin:18px 0 0;padding:12px 16px;background:rgba(240,82,79,.12);border-radius:10px;font:600 13px/1.5 Helvetica,Arial,sans-serif;color:#f0524f;">Película +'
            || v_p.restriccion_edad || ': los menores deben ingresar acompañados por un adulto.</p>'
       else '' end;

  perform enviar_correo(
    v_c.email_contacto,
    'Tu entrada para ' || v_titulo || ' · código ' || v_c.codigo,
    plantilla_correo('Tu compra quedó confirmada',
      'Guardá este correo: con el código de abajo entrás a la sala y retirás el candy bar.',
      v_cuerpo, 'Ver mi entrada con el QR', v_url),
    'compra_confirmada');
end $$;

create or replace function fn_correo_cancelacion()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_p peliculas; v_f funciones; v_cuerpo text; v_canjes boolean; v_invitado boolean;
begin
  if new.estado <> 'cancelada' or old.estado = 'cancelada' then return new; end if;

  select * into v_f from funciones where id = new.funcion_id;
  select * into v_p from peliculas where id = v_f.pelicula_id;

  v_invitado := new.usuario_id is null;
  v_canjes := new.descuento_canjes > 0
           or exists (select 1 from compra_items ci
                       where ci.compra_id = new.id and ci.precio_unitario = 0 and ci.nombre like '% (canje)');

  v_cuerpo :=
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1a1d28;border-radius:12px;padding:20px 22px;">'
    || '<tr><td style="font:400 14px/1.9 Helvetica,Arial,sans-serif;color:#a8adbd;">'
    || '<strong style="color:#f2f3f7;">Película:</strong> ' || escapar_html(coalesce(v_p.titulo, '-')) || '<br>'
    || '<strong style="color:#f2f3f7;">Código:</strong> ' || escapar_html(new.codigo)
    || case when v_invitado then ''
       else '<br><strong style="color:#f2f3f7;">Crédito acreditado:</strong> <span style="color:#3fcf8e;">'
            || formato_pesos(new.total + new.credito_usado) || '</span>' end
    || '</td></tr></table>'
    || case when v_invitado
       then '<p style="margin:18px 0 0;font:400 14px/1.7 Helvetica,Arial,sans-serif;color:#a8adbd;">'
            || 'Las entradas de esta compra quedaron anuladas. Si tenés dudas, acercate a la boletería con el código de la compra.</p>'
       else '<p style="margin:18px 0 0;font:400 14px/1.7 Helvetica,Arial,sans-serif;color:#a8adbd;">'
            || 'El importe quedó como crédito en tu cuenta y lo podés usar en tu próxima compra, '
            || 'combinándolo con cualquier otro medio de pago.</p>' end
    || case when v_canjes and not v_invitado
       then '<p style="margin:12px 0 0;font:400 14px/1.7 Helvetica,Arial,sans-serif;color:#a8adbd;">'
            || 'Los canjes de puntos que habías usado volvieron a quedar disponibles en tu cuenta.</p>'
       else '' end;

  perform enviar_correo(
    new.email_contacto,
    'Cancelamos tu compra ' || new.codigo,
    plantilla_correo('Tu compra fue cancelada',
      case when v_invitado then 'Las entradas de esta compra ya no son válidas.'
           else 'Ya te acreditamos el importe como crédito en tu cuenta.' end,
      v_cuerpo,
      case when v_invitado then 'Ver la cartelera' else 'Ver mis compras' end,
      coalesce(valor_de_configuracion('url_app'),'') || case when v_invitado then '/peliculas' else '/cuenta/compras' end),
    'compra_cancelada');
  return new;
end $$;

create or replace function fn_correo_bienvenida()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cupon cupones; v_cuerpo text;
begin
  select * into v_cupon from cupones where tipo = 'bienvenida' and activo order by id limit 1;
  if not found then return new; end if;

  v_cuerpo :=
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1a1d28;border:1px solid #f5b43c;border-radius:12px;padding:24px;">'
    || '<tr><td align="center">'
    || '<div style="font:700 11px Helvetica,Arial,sans-serif;color:#f5b43c;letter-spacing:2px;">TU CUPÓN DE BIENVENIDA</div>'
    || '<div style="font:800 32px/1.5 Courier New,monospace;color:#ffd27f;letter-spacing:3px;">' || escapar_html(v_cupon.codigo) || '</div>'
    || '<div style="font:700 17px Helvetica,Arial,sans-serif;color:#f2f3f7;">'
    || to_char(v_cupon.porcentaje, 'FM999') || '% de descuento en tu primera compra</div>'
    || '</td></tr></table>'
    || '<p style="margin:22px 0 0;font:400 14px/1.7 Helvetica,Arial,sans-serif;color:#a8adbd;">'
    || 'Además, desde ahora sumás 1 punto por cada peso que gastes. Los podés canjear por '
    || 'entradas gratis y productos del candy bar.</p>';

  perform enviar_correo(
    new.email,
    'Bienvenido a CineNova: te regalamos un ' || to_char(v_cupon.porcentaje,'FM999') || '% de descuento',
    plantilla_correo('Ya sos parte de CineNova',
      'Tu cuenta quedó creada. Te esperamos en la sala.',
      v_cuerpo, 'Ver la cartelera',
      coalesce(valor_de_configuracion('url_app'),'') || '/peliculas'),
    'bienvenida');
  return new;
end $$;

create or replace function notificar_apertura_venta(p_pelicula_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_p peliculas; v_a record; v_cuerpo text; v_url text;
  v_preventa boolean; v_asunto text; v_titulo text; v_bajada text;
begin
  select * into v_p from peliculas where id = p_pelicula_id;
  if not found or not venta_abierta(p_pelicula_id) then return; end if;
  if valor_de_configuracion('brevo_api_key') is null or valor_de_configuracion('correo_remitente') is null then
    return;
  end if;

  v_preventa := preventa_vigente(p_pelicula_id);
  v_url := coalesce(valor_de_configuracion('url_app'),'') || '/peliculas/' || v_p.id;

  if v_preventa then
    v_asunto := 'Abrió la preventa de ' || v_p.titulo;
    v_titulo := 'Se abrió la preventa';
    v_bajada := 'Activaste una alerta para esta película y ya podés comprar tus entradas a precio especial.';
  else
    v_asunto := 'Ya podés comprar tus entradas para ' || v_p.titulo;
    v_titulo := 'Se abrió la venta';
    v_bajada := 'Activaste una alerta para esta película y ya tiene funciones disponibles.';
  end if;

  v_cuerpo :=
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1a1d28;border-radius:12px;padding:20px 22px;">'
    || '<tr><td style="font:700 19px Helvetica,Arial,sans-serif;color:#f2f3f7;padding-bottom:8px;">' || escapar_html(v_p.titulo) || '</td></tr>'
    || '<tr><td style="font:400 14px/1.7 Helvetica,Arial,sans-serif;color:#a8adbd;">' || escapar_html(left(v_p.sinopsis, 260)) || '</td></tr>'
    || '</table>'
    || case when v_preventa
       then '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;background:#1a1d28;border:1px solid #f5b43c;border-radius:12px;padding:18px 22px;">'
            || '<tr><td style="font:400 14px/1.7 Helvetica,Arial,sans-serif;color:#a8adbd;">'
            || '<strong style="color:#ffd27f;">Precio de preventa: ' || formato_pesos(v_p.precio_preventa) || '</strong><br>'
            || 'Vale hasta el ' || to_char(v_p.fecha_estreno - 1, 'DD/MM') || '. Desde el estreno, el '
            || to_char(v_p.fecha_estreno, 'DD/MM') || ', las entradas vuelven a su precio normal.'
            || '</td></tr></table>'
       else '' end;

  for v_a in
    select a.id, pf.email
      from alertas_estreno a
      join perfiles pf on pf.id = a.usuario_id
     where a.pelicula_id = p_pelicula_id and a.notificada = false
     for update of a
  loop
    if enviar_correo(v_a.email, v_asunto,
         plantilla_correo(v_titulo, v_bajada, v_cuerpo, 'Ver funciones y comprar', v_url),
         'alerta_estreno') then
      update alertas_estreno set notificada = true where id = v_a.id;
    end if;
  end loop;
end $$;

create or replace function abrir_ventas_del_dia()
returns void language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  perform conciliar_correos();

  update peliculas set en_cartelera = true
   where not en_cartelera and not estreno_procesado
     and fecha_estreno is not null and fecha_estreno <= hoy_local();

  for v_id in
    select distinct a.pelicula_id from alertas_estreno a
     where a.notificada = false and venta_abierta(a.pelicula_id)
  loop
    perform notificar_apertura_venta(v_id);
  end loop;

  delete from reservas
   where id in (select id from reservas where expira_en < now() for update skip locked);
end $$;

drop policy if exists perfiles_insert on perfiles;

revoke select on entradas from anon, authenticated;
grant select (id, funcion_id, butaca_id, activa) on entradas to anon, authenticated;

drop policy if exists compras_select on compras;
create policy compras_select on compras for select
  using (usuario_id = auth.uid() or es_admin());

drop policy if exists compra_items_select on compra_items;
create policy compra_items_select on compra_items for select
  using (exists (select 1 from compras c
                  where c.id = compra_items.compra_id
                    and (c.usuario_id = auth.uid() or es_admin())));

revoke execute on function promover(text, rol_usuario)                         from public, anon, authenticated;
revoke execute on function registrar_log(text, text, text, jsonb)              from public, anon, authenticated;
revoke execute on function correo_de_compra(bigint)                            from public, anon, authenticated;
revoke execute on function enviar_correo(text, text, text, text)               from public, anon, authenticated;
revoke execute on function conciliar_correos()                                 from public, anon, authenticated;
revoke execute on function notificar_apertura_venta(bigint)                    from public, anon, authenticated;
revoke execute on function abrir_ventas_del_dia()                              from public, anon, authenticated;
revoke execute on function valor_de_configuracion(text)                        from public, anon, authenticated;
revoke execute on function formato_pesos(numeric)                              from public, anon, authenticated;
revoke execute on function plantilla_correo(text, text, text, text, text)      from public, anon, authenticated;
revoke execute on function linea_correo(text, text, text)                      from public, anon, authenticated;
revoke execute on function descripcion_medio_pago(compras)                     from public, anon, authenticated;
revoke execute on function escapar_html(text)                                  from public, anon, authenticated;
revoke execute on function enmascarar_email(text)                              from public, anon, authenticated;
revoke execute on function huella_de_sesion(text)                              from public, anon, authenticated;
revoke execute on function funcion_con_ventas(bigint)                          from public, anon, authenticated;
revoke execute on function hoy_local()                                         from public, anon, authenticated;
revoke execute on function generar_butacas(bigint)                             from public, anon, authenticated;
revoke execute on function limpiar_reservas_vencidas()                         from public, anon, authenticated;
revoke execute on function handle_new_user()                                   from public, anon, authenticated;
revoke execute on function fn_perfiles_proteger()                              from public, anon, authenticated;
revoke execute on function fn_salas_butacas()                                  from public, anon, authenticated;
revoke execute on function fn_funciones_ocupacion()                            from public, anon, authenticated;
revoke execute on function fn_funciones_proteger_ventas()                      from public, anon, authenticated;
revoke execute on function fn_peliculas_duracion()                             from public, anon, authenticated;
revoke execute on function fn_peliculas_estreno()                              from public, anon, authenticated;
revoke execute on function fn_productos_proteger()                             from public, anon, authenticated;
revoke execute on function fn_resenias_estreno()                               from public, anon, authenticated;
revoke execute on function fn_auditar()                                        from public, anon, authenticated;
revoke execute on function fn_correo_cancelacion()                             from public, anon, authenticated;
revoke execute on function fn_correo_bienvenida()                              from public, anon, authenticated;
revoke execute on function fn_correo_estreno()                                 from public, anon, authenticated;

revoke execute on function cancelar_compra(bigint)                             from public, anon;
revoke execute on function canjear_recompensa(bigint)                          from public, anon;
revoke execute on function mis_peliculas()                                     from public, anon;
revoke execute on function validar_qr(text, text)                              from public, anon;
revoke execute on function crear_funcion(bigint, timestamptz, formato_funcion, idioma_funcion, numeric, numeric) from public, anon;
revoke execute on function reporte_facturacion(date, date)                     from public, anon;
revoke execute on function peliculas_mas_vistas(text)                          from public, anon;
revoke execute on function top_productos(int)                                  from public, anon;
revoke execute on function estadisticas_admin()                                from public, anon;

grant execute on function cancelar_compra(bigint)                              to authenticated;
grant execute on function canjear_recompensa(bigint)                           to authenticated;
grant execute on function mis_peliculas()                                      to authenticated;
grant execute on function validar_qr(text, text)                               to authenticated;
grant execute on function crear_funcion(bigint, timestamptz, formato_funcion, idioma_funcion, numeric, numeric) to authenticated;
grant execute on function reporte_facturacion(date, date)                      to authenticated;
grant execute on function peliculas_mas_vistas(text)                           to authenticated;
grant execute on function top_productos(int)                                   to authenticated;
grant execute on function estadisticas_admin()                                 to authenticated;

grant execute on function reservar_butacas(bigint, bigint[], text)             to anon, authenticated;
grant execute on function butacas_estado(bigint, text)                         to anon, authenticated;
grant execute on function registrar_compra(bigint, bigint[], jsonb, text, text, numeric, date, text, text[], text, text, text, numeric) to anon, authenticated;
grant execute on function buscar_compra(text)                                  to anon, authenticated;
grant execute on function resenias_de_pelicula(bigint)                         to anon, authenticated;
grant execute on function peliculas_mas_vendidas(int, int)                     to anon, authenticated;
grant execute on function venta_abierta(bigint)                                to anon, authenticated;
grant execute on function preventa_vigente(bigint)                             to anon, authenticated;
grant execute on function es_admin()                                           to anon, authenticated;
grant execute on function es_empleado()                                        to anon, authenticated;
