create or replace function registrar_log(p_accion text, p_entidad text, p_entidad_id text, p_detalle jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into log_actividad (usuario_id, email, accion, entidad, entidad_id, detalle)
  values (auth.uid(), (select email from perfiles where id = auth.uid()), p_accion, p_entidad, p_entidad_id, p_detalle);
end $$;

create or replace function crear_funcion(
  p_pelicula_id bigint, p_inicio timestamptz,
  p_formato formato_funcion, p_idioma idioma_funcion,
  p_precio numeric, p_precio_vip numeric default 0)
returns funciones language plpgsql security definer set search_path = public as $$
declare v_dur int; v_fin timestamptz; v_sala bigint; v_row funciones;
begin
  if not es_admin() then raise exception 'No autorizado'; end if;

  select duracion_min into v_dur from peliculas where id = p_pelicula_id;
  if v_dur is null then raise exception 'La pelicula no existe'; end if;

  v_fin := p_inicio + (v_dur || ' minutes')::interval;

  select s.id into v_sala from salas s
  where not exists (
    select 1 from funciones f
    where f.sala_id = s.id
      and f.ocupacion && tstzrange(p_inicio, v_fin + interval '30 minutes', '[)'))
  order by s.id limit 1;

  if v_sala is null then
    raise exception 'No hay salas disponibles en ese horario';
  end if;

  insert into funciones (pelicula_id, sala_id, inicio, fin, formato, idioma, precio_base, precio_vip, creada_por)
  values (p_pelicula_id, v_sala, p_inicio, v_fin, p_formato, p_idioma, p_precio, p_precio_vip, auth.uid())
  returning * into v_row;

  perform registrar_log('crear', 'funcion', v_row.id::text,
    jsonb_build_object('pelicula_id', p_pelicula_id, 'sala_id', v_sala, 'inicio', p_inicio));

  return v_row;
end $$;

create or replace function reservar_butacas(p_funcion_id bigint, p_butacas bigint[], p_sesion text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from reservas where expira_en < now();
  delete from reservas where sesion = p_sesion;
  if coalesce(array_length(p_butacas,1),0) > 0 then
    insert into reservas (funcion_id, butaca_id, sesion)
    select p_funcion_id, b, p_sesion from unnest(p_butacas) b
    on conflict (funcion_id, butaca_id) do nothing;
  end if;
end $$;

create or replace function butacas_estado(p_funcion_id bigint, p_sesion text default '')
returns table (butaca_id bigint, estado text)
language sql stable security definer set search_path = public as $$
  select e.butaca_id, 'vendida'::text
    from entradas e where e.funcion_id = p_funcion_id and e.activa
  union all
  select r.butaca_id, 'reservada'::text
    from reservas r
   where r.funcion_id = p_funcion_id and r.expira_en > now() and r.sesion <> p_sesion;
$$;

create or replace function registrar_compra(
  p_funcion_id bigint,
  p_butacas bigint[],
  p_items jsonb default '[]'::jsonb,
  p_email text default null,
  p_cupon_codigo text default null,
  p_usar_credito numeric default 0,
  p_fecha_nacimiento date default null,
  p_sesion text default null)
returns compras language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_perfil perfiles;
  v_f funciones;
  v_p peliculas;
  v_edad int;
  v_preventa boolean := false;
  v_precio_est numeric; v_precio_vip numeric;
  v_sub numeric := 0; v_desc numeric := 0; v_cred numeric := 0; v_total numeric;
  v_cupon cupones;
  v_compra compras;
  v_codigo text;
  v_b record;
  v_item jsonb;
  v_nac date;
  v_cant int;
begin
  if p_funcion_id is null then raise exception 'Falta indicar la funcion'; end if;
  v_cant := coalesce(array_length(p_butacas,1),0);
  if v_cant = 0 then raise exception 'Seleccioná al menos una butaca'; end if;
  if v_cant > 10 then raise exception 'No se pueden comprar mas de 10 entradas por operacion'; end if;

  select * into v_f from funciones where id = p_funcion_id;
  if not found then raise exception 'La funcion no existe'; end if;
  if v_f.inicio <= now() then raise exception 'La funcion ya comenzo'; end if;

  select * into v_p from peliculas where id = v_f.pelicula_id;

  if v_uid is not null then
    select * into v_perfil from perfiles where id = v_uid;
  end if;

  v_nac := coalesce(v_perfil.fecha_nacimiento, p_fecha_nacimiento);

  if v_p.restriccion_edad > 0 then
    if v_nac is null then
      raise exception 'Necesitamos tu fecha de nacimiento para esta pelicula';
    end if;
    v_edad := extract(year from age(v_nac))::int;
    if v_edad < v_p.restriccion_edad then
      raise exception 'No cumplis la edad minima (+%) para esta pelicula', v_p.restriccion_edad;
    end if;
  end if;

  v_preventa := v_p.precio_preventa is not null
            and v_p.fecha_estreno is not null
            and now()::date < v_p.fecha_estreno
            and now()::date >= v_p.fecha_estreno - 7;

  if v_preventa then
    v_precio_est := v_p.precio_preventa;
    v_precio_vip := round(v_p.precio_preventa * 1.5, 2);
  else
    v_precio_est := v_f.precio_base;
    v_precio_vip := v_f.precio_vip;
  end if;

  v_codigo := substr(upper(replace(gen_random_uuid()::text, '-', '')), 1, 12);

  insert into compras (usuario_id, email_contacto, codigo, funcion_id)
  values (v_uid, coalesce(nullif(trim(coalesce(p_email,'')),''), coalesce(v_perfil.email,'invitado@cinenova.app')), v_codigo, p_funcion_id)
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
    v_sub := v_sub + case when v_b.tipo = 'vip' then v_precio_vip else v_precio_est end;
  end loop;

  if (select count(*) from entradas where compra_id = v_compra.id) <> v_cant then
    raise exception 'Alguna butaca no pertenece a la sala de esta funcion';
  end if;

  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    for v_item in select * from jsonb_array_elements(p_items) loop
      insert into compra_items (compra_id, producto_id, combo_id, nombre, cantidad, precio_unitario)
      values (v_compra.id,
              nullif(v_item->>'producto_id','')::bigint,
              nullif(v_item->>'combo_id','')::bigint,
              coalesce(v_item->>'nombre','Producto'),
              greatest(1, coalesce((v_item->>'cantidad')::int,1)),
              greatest(0, coalesce((v_item->>'precio_unitario')::numeric,0)));
      v_sub := v_sub + greatest(1, coalesce((v_item->>'cantidad')::int,1))
                     * greatest(0, coalesce((v_item->>'precio_unitario')::numeric,0));
    end loop;
  end if;

  if p_cupon_codigo is not null and length(trim(p_cupon_codigo)) > 0 then
    select * into v_cupon from cupones
     where upper(codigo) = upper(trim(p_cupon_codigo)) and activo;
    if not found then raise exception 'El cupon no es valido'; end if;
    if v_uid is null then raise exception 'Los cupones son solo para usuarios registrados'; end if;
    if v_cupon.tipo = 'bienvenida' and v_perfil.cupon_bienvenida_usado then
      raise exception 'Ya usaste el cupon de bienvenida';
    end if;
    if v_cupon.tipo = 'edad' then
      if v_nac is null or extract(year from age(v_nac))::int < coalesce(v_cupon.edad_minima, 0) then
        raise exception 'Este cupon no aplica a tu edad';
      end if;
    end if;
    v_desc := round(v_sub * v_cupon.porcentaje / 100, 2);
  end if;

  v_total := v_sub - v_desc;

  if coalesce(p_usar_credito,0) > 0 then
    if v_uid is null then raise exception 'El credito es solo para usuarios registrados'; end if;
    v_cred := least(p_usar_credito, v_perfil.credito, v_total);
    v_total := v_total - v_cred;
  end if;

  update compras
     set subtotal = v_sub, descuento = v_desc, credito_usado = v_cred, total = v_total,
         cupon_id = v_cupon.id,
         puntos_ganados = case when v_uid is null then 0 else floor(v_total)::int end
   where id = v_compra.id
  returning * into v_compra;

  if v_uid is not null then
    perform set_config('app.bypass_perfil','on',true);
    update perfiles
       set credito = credito - v_cred,
           puntos  = puntos + v_compra.puntos_ganados,
           cupon_bienvenida_usado = cupon_bienvenida_usado or coalesce(v_cupon.tipo = 'bienvenida', false)
     where id = v_uid;
  end if;

  delete from reservas where funcion_id = p_funcion_id and butaca_id = any(p_butacas);
  if p_sesion is not null then delete from reservas where sesion = p_sesion; end if;

  return v_compra;
end $$;

create or replace function cancelar_compra(p_compra_id bigint)
returns compras language plpgsql security definer set search_path = public as $$
declare v_c compras; v_f funciones;
begin
  select * into v_c from compras where id = p_compra_id;
  if not found then raise exception 'La compra no existe'; end if;
  if v_c.usuario_id is distinct from auth.uid() and not es_admin() then
    raise exception 'No podes cancelar esta compra';
  end if;
  if v_c.estado = 'cancelada' then raise exception 'La compra ya estaba cancelada'; end if;
  if v_c.entrada_validada then raise exception 'La entrada ya fue utilizada'; end if;

  select * into v_f from funciones where id = v_c.funcion_id;
  if v_f.id is not null and v_f.inicio - now() < interval '2 hours' then
    raise exception 'Solo se puede cancelar hasta 2 horas antes de la funcion';
  end if;

  update entradas set activa = false where compra_id = v_c.id;
  update compras set estado = 'cancelada' where id = v_c.id returning * into v_c;

  if v_c.usuario_id is not null then
    perform set_config('app.bypass_perfil','on',true);
    update perfiles
       set credito = credito + v_c.total + v_c.credito_usado,
           puntos  = greatest(0, puntos - v_c.puntos_ganados)
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

  select * into v_c from compras where upper(codigo) = upper(trim(p_codigo));
  if not found then return jsonb_build_object('ok', false, 'motivo', 'El codigo no existe'); end if;
  if v_c.estado = 'cancelada' then return jsonb_build_object('ok', false, 'motivo', 'La compra fue cancelada'); end if;

  if p_tipo = 'entrada' then
    if v_c.funcion_id is null then return jsonb_build_object('ok', false, 'motivo', 'La compra no incluye entradas'); end if;
    if v_c.entrada_validada then return jsonb_build_object('ok', false, 'motivo', 'La entrada ya fue utilizada'); end if;
    select * into v_f from funciones where id = v_c.funcion_id;
    if now() > v_f.fin then return jsonb_build_object('ok', false, 'motivo', 'La funcion ya termino'); end if;
    update compras set entrada_validada = true, entrada_validada_en = now() where id = v_c.id;
  elsif p_tipo = 'candy' then
    if not exists (select 1 from compra_items where compra_id = v_c.id) then
      return jsonb_build_object('ok', false, 'motivo', 'La compra no incluye productos');
    end if;
    if v_c.productos_entregados then return jsonb_build_object('ok', false, 'motivo', 'Los productos ya fueron entregados'); end if;
    update compras set productos_entregados = true, productos_entregados_en = now() where id = v_c.id;
    update compra_items set entregado = true where compra_id = v_c.id;
  else
    raise exception 'Tipo de validacion invalido';
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
    'compra', to_jsonb(v_c),
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

create or replace function canjear_recompensa(p_recompensa_id bigint)
returns canjes language plpgsql security definer set search_path = public as $$
declare v_r recompensas; v_p perfiles; v_c canjes;
begin
  if auth.uid() is null then raise exception 'Tenes que iniciar sesion'; end if;
  select * into v_r from recompensas where id = p_recompensa_id and activo;
  if not found then raise exception 'La recompensa no esta disponible'; end if;
  select * into v_p from perfiles where id = auth.uid();
  if v_p.puntos < v_r.costo_puntos then raise exception 'No te alcanzan los puntos'; end if;

  perform set_config('app.bypass_perfil','on',true);
  update perfiles set puntos = puntos - v_r.costo_puntos where id = auth.uid();

  insert into canjes (usuario_id, recompensa_id, nombre, puntos_gastados)
  values (auth.uid(), v_r.id, v_r.nombre, v_r.costo_puntos)
  returning * into v_c;
  return v_c;
end $$;

create or replace function peliculas_mas_vendidas(p_limite int default 3, p_dias int default 30)
returns table (pelicula_id bigint, titulo text, imagen_url text, vendidas bigint)
language sql stable security definer set search_path = public as $$
  select p.id, p.titulo, p.imagen_url, count(e.id)::bigint
    from entradas e
    join compras   c on c.id = e.compra_id
    join funciones f on f.id = e.funcion_id
    join peliculas p on p.id = f.pelicula_id
   where e.activa and c.estado = 'pagada'
     and c.creado_en >= now() - (p_dias || ' days')::interval
   group by p.id, p.titulo, p.imagen_url
   order by 4 desc, 2 asc
   limit greatest(1, p_limite);
$$;

create or replace function reporte_facturacion(p_desde date, p_hasta date)
returns table (dia date, compras bigint, entradas bigint, productos bigint, facturado numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'No autorizado'; end if;
  return query
    select c.creado_en::date,
           count(distinct c.id)::bigint,
           coalesce(sum((select count(*) from entradas e where e.compra_id = c.id and e.activa)),0)::bigint,
           coalesce(sum((select coalesce(sum(ci.cantidad),0) from compra_items ci where ci.compra_id = c.id)),0)::bigint,
           coalesce(sum(c.total + c.credito_usado),0)
      from compras c
     where c.estado = 'pagada' and c.creado_en::date between p_desde and p_hasta
     group by 1 order by 1;
end $$;

create or replace function peliculas_mas_vistas(p_agrupacion text default 'semana')
returns table (periodo text, titulo text, vistas bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'No autorizado'; end if;
  return query
    select to_char(date_trunc(case when p_agrupacion = 'mes' then 'month' else 'week' end, c.creado_en),
                   case when p_agrupacion = 'mes' then 'MM/YYYY' else 'DD/MM' end),
           p.titulo,
           count(e.id)::bigint
      from entradas e
      join compras   c on c.id = e.compra_id
      join funciones f on f.id = e.funcion_id
      join peliculas p on p.id = f.pelicula_id
     where e.activa and c.estado = 'pagada'
     group by 1, 2, date_trunc(case when p_agrupacion = 'mes' then 'month' else 'week' end, c.creado_en)
     order by date_trunc(case when p_agrupacion = 'mes' then 'month' else 'week' end, c.creado_en) desc, 3 desc
     limit 40;
end $$;

create or replace function top_productos(p_limite int default 10)
returns table (nombre text, unidades bigint, facturado numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'No autorizado'; end if;
  return query
    select ci.nombre, sum(ci.cantidad)::bigint, sum(ci.cantidad * ci.precio_unitario)
      from compra_items ci
      join compras c on c.id = ci.compra_id
     where c.estado = 'pagada'
     group by ci.nombre
     order by 2 desc
     limit greatest(1, p_limite);
end $$;

create or replace function mis_peliculas()
returns table (pelicula_id bigint, titulo text, imagen_url text, vista_en timestamptz, estrellas int)
language sql stable security definer set search_path = public as $$
  select distinct on (p.id)
         p.id, p.titulo, p.imagen_url, f.inicio,
         (select r.estrellas from resenias r where r.pelicula_id = p.id and r.usuario_id = auth.uid())
    from compras c
    join funciones f on f.id = c.funcion_id
    join peliculas p on p.id = f.pelicula_id
   where c.usuario_id = auth.uid() and c.estado = 'pagada' and f.inicio < now()
   order by p.id, f.inicio desc;
$$;

create or replace function estadisticas_admin()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'No autorizado'; end if;
  return jsonb_build_object(
    'facturado_hoy',  (select coalesce(sum(total + credito_usado),0) from compras where estado='pagada' and creado_en::date = now()::date),
    'entradas_hoy',   (select count(*) from entradas e join compras c on c.id=e.compra_id where e.activa and c.estado='pagada' and c.creado_en::date = now()::date),
    'facturado_mes',  (select coalesce(sum(total + credito_usado),0) from compras where estado='pagada' and creado_en >= date_trunc('month', now())),
    'usuarios',       (select count(*) from perfiles),
    'peliculas',      (select count(*) from peliculas where en_cartelera),
    'funciones_hoy',  (select count(*) from funciones where inicio::date = now()::date)
  );
end $$;
