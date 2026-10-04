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
  if v_dur is null then raise exception 'La película no existe'; end if;

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

  return v_row;
end $$;

drop function if exists reservar_butacas(bigint, bigint[], text);

create or replace function reservar_butacas(p_funcion_id bigint, p_butacas bigint[], p_sesion text)
returns void language plpgsql security definer set search_path = public as $$
declare v_f funciones;
begin
  delete from reservas where expira_en < now();
  delete from reservas where sesion = p_sesion;
  if coalesce(array_length(p_butacas,1),0) > 0 then
    select * into v_f from funciones where id = p_funcion_id;
    if not found then raise exception 'La función no existe'; end if;
    if v_f.inicio <= now() then raise exception 'La función ya comenzó'; end if;
    if not venta_abierta(v_f.pelicula_id) then
      raise exception 'La venta de entradas para esta película todavía no está abierta';
    end if;
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

create or replace function hoy_local()
returns date language sql stable as $$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date;
$$;

create or replace function preventa_vigente(p_pelicula_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.precio_preventa is not null
       and p.fecha_estreno is not null
       and hoy_local() >= p.fecha_estreno - 7
       and hoy_local() <  p.fecha_estreno
      from peliculas p
     where p.id = p_pelicula_id), false);
$$;

create or replace function venta_abierta(p_pelicula_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.en_cartelera
        or (p.fecha_estreno is not null
            and hoy_local() >= p.fecha_estreno - case when p.precio_preventa is not null then 7 else 0 end)
      from peliculas p
     where p.id = p_pelicula_id), false);
$$;

drop function if exists registrar_compra(bigint, bigint[], jsonb, text, text, numeric, date, text);
drop function if exists registrar_compra(bigint, bigint[], jsonb, text, text, numeric, date, text, text[], text, text, text);

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
  v_sub numeric := 0; v_sub_entradas numeric := 0; v_canje numeric := 0;
  v_desc numeric := 0; v_cred numeric := 0; v_total numeric;
  v_producto_id bigint; v_combo_id bigint; v_unidades int;
  v_nombre_item text; v_precio_item numeric;
  v_cupon cupones;
  v_compra compras;
  v_codigo text;
  v_b record;
  v_item jsonb;
  v_nac date;
  v_cant int;
  v_pedidos text[];
  v_codigos text[] := '{}';
  v_cj canjes;
  v_entradas_canje int := 0;
  v_prod productos;
  v_medio medio_pago;
begin
  if p_funcion_id is null then raise exception 'Falta indicar la función'; end if;
  v_cant := coalesce(array_length(p_butacas,1),0);
  if v_cant = 0 then raise exception 'Seleccioná al menos una butaca'; end if;
  if v_cant > 10 then raise exception 'No se pueden comprar más de 10 entradas por operación'; end if;
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

  if v_uid is not null then
    select * into v_perfil from perfiles where id = v_uid for update;
  end if;

  v_nac := coalesce(v_perfil.fecha_nacimiento, p_fecha_nacimiento);

  if v_p.restriccion_edad > 0 then
    if v_nac is null then
      raise exception 'Necesitamos tu fecha de nacimiento para esta película';
    end if;
    v_edad := extract(year from age(v_nac))::int;
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
        select nombre, precio into v_nombre_item, v_precio_item from productos where id = v_producto_id and activo;
      else
        select nombre, precio into v_nombre_item, v_precio_item from combos where id = v_combo_id and activo;
      end if;
      if not found then
        raise exception 'Uno de los productos del pedido ya no está disponible';
      end if;

      insert into compra_items (compra_id, producto_id, combo_id, nombre, cantidad, precio_unitario)
      values (v_compra.id, v_producto_id, v_combo_id, v_nombre_item, v_unidades, v_precio_item);
      v_sub := v_sub + v_unidades * v_precio_item;
    end loop;
  end if;

  for v_cj in select c.* from canjes c where c.codigo = any(v_codigos) and c.tipo = 'producto' loop
    select * into v_prod from productos where id = v_cj.producto_id;
    if not found then raise exception 'El producto del canje % ya no existe', v_cj.codigo; end if;
    insert into compra_items (compra_id, producto_id, nombre, cantidad, precio_unitario)
    values (v_compra.id, v_prod.id, v_prod.nombre || ' (canje)', 1, 0);
  end loop;

  v_canje := least(v_entradas_canje * v_precio_est, v_sub_entradas);

  if p_cupon_codigo is not null and length(trim(p_cupon_codigo)) > 0 then
    select * into v_cupon from cupones
     where upper(codigo) = upper(trim(p_cupon_codigo)) and activo;
    if not found then raise exception 'El cupón no es válido'; end if;
    if v_uid is null then raise exception 'Los cupones son solo para usuarios registrados'; end if;
    if v_cupon.tipo = 'bienvenida' and v_perfil.cupon_bienvenida_usado then
      raise exception 'Ya usaste el cupón de bienvenida';
    end if;
    if v_cupon.tipo = 'edad' then
      if v_nac is null or extract(year from age(v_nac))::int < coalesce(v_cupon.edad_minima, 0) then
        raise exception 'Este cupón no aplica a tu edad';
      end if;
    end if;
    v_desc := round((v_sub - v_canje) * v_cupon.porcentaje / 100, 2);
  end if;

  v_total := greatest(0, round(v_sub - v_canje - v_desc, 2));

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
     set subtotal = v_sub, descuento = v_desc, descuento_canjes = v_canje,
         credito_usado = v_cred, total = v_total, cupon_id = v_cupon.id,
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
           cupon_bienvenida_usado = cupon_bienvenida_usado or coalesce(v_cupon.tipo = 'bienvenida', false)
     where id = v_uid;
  end if;

  delete from reservas where funcion_id = p_funcion_id and butaca_id = any(p_butacas);
  if p_sesion is not null then delete from reservas where sesion = p_sesion; end if;

  begin
    perform correo_de_compra(v_compra.id);
  exception when undefined_function then null;
  end;

  return v_compra;
end $$;

create or replace function cancelar_compra(p_compra_id bigint)
returns compras language plpgsql security definer set search_path = public as $$
declare v_c compras; v_f funciones;
begin
  select * into v_c from compras where id = p_compra_id for update;
  if not found then raise exception 'La compra no existe'; end if;
  if v_c.usuario_id is distinct from auth.uid() and not es_admin() then
    raise exception 'No podés cancelar esta compra';
  end if;
  if v_c.estado = 'cancelada' then raise exception 'La compra ya estaba cancelada'; end if;
  if v_c.entrada_validada then raise exception 'La entrada ya fue utilizada'; end if;
  if v_c.productos_entregados then raise exception 'Los productos del candy bar ya fueron entregados'; end if;

  select * into v_f from funciones where id = v_c.funcion_id;
  if v_f.id is not null and v_f.inicio - now() < interval '2 hours' then
    raise exception 'Solo se puede cancelar hasta 2 horas antes de la función';
  end if;

  update entradas set activa = false where compra_id = v_c.id;
  update canjes set usado = false, usado_en = null, compra_id = null where compra_id = v_c.id;
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
  if not found then return jsonb_build_object('ok', false, 'motivo', 'El código no existe'); end if;
  if v_c.estado = 'cancelada' then return jsonb_build_object('ok', false, 'motivo', 'La compra fue cancelada'); end if;

  if p_tipo = 'entrada' then
    if v_c.funcion_id is null then return jsonb_build_object('ok', false, 'motivo', 'La compra no incluye entradas'); end if;
    if v_c.entrada_validada then return jsonb_build_object('ok', false, 'motivo', 'La entrada ya fue utilizada'); end if;
    select * into v_f from funciones where id = v_c.funcion_id;
    if now() > v_f.fin then return jsonb_build_object('ok', false, 'motivo', 'La función ya terminó'); end if;
    update compras set entrada_validada = true, entrada_validada_en = now() where id = v_c.id;
  elsif p_tipo = 'candy' then
    if not exists (select 1 from compra_items where compra_id = v_c.id) then
      return jsonb_build_object('ok', false, 'motivo', 'La compra no incluye productos');
    end if;
    if v_c.productos_entregados then return jsonb_build_object('ok', false, 'motivo', 'Los productos ya fueron entregados'); end if;
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
  if auth.uid() is null then raise exception 'Tenés que iniciar sesión'; end if;

  select * into v_r from recompensas where id = p_recompensa_id and activo;
  if not found then raise exception 'La recompensa no está disponible'; end if;
  if v_r.tipo = 'producto' and v_r.producto_id is null then
    raise exception 'La recompensa no tiene un producto asociado';
  end if;

  select * into v_p from perfiles where id = auth.uid() for update;
  if v_p.puntos < v_r.costo_puntos then raise exception 'No te alcanzan los puntos'; end if;

  perform set_config('app.bypass_perfil','on',true);
  update perfiles set puntos = puntos - v_r.costo_puntos where id = auth.uid();

  insert into canjes (usuario_id, recompensa_id, nombre, puntos_gastados, codigo, tipo, producto_id)
  values (auth.uid(), v_r.id, v_r.nombre, v_r.costo_puntos,
          'CJ' || substr(upper(replace(gen_random_uuid()::text, '-', '')), 1, 8),
          v_r.tipo, v_r.producto_id)
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
