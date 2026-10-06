alter table compras add column if not exists requiere_adulto boolean not null default false;
alter table compras add column if not exists adulto_codigo   text;
alter table compras add column if not exists comprador_mayor boolean;

do $$ begin
  alter table compras add constraint compras_adulto_codigo_fkey
    foreign key (adulto_codigo) references compras(codigo) on delete set null;
exception when duplicate_object then null; end $$;

create index if not exists idx_compras_adulto_codigo on compras(adulto_codigo) where adulto_codigo is not null;

update compras c
   set comprador_mayor = extract(year from age((c.creado_en at time zone 'America/Argentina/Buenos_Aires')::date, p.fecha_nacimiento))::int >= 18
  from perfiles p
 where p.id = c.usuario_id
   and c.comprador_mayor is null
   and p.fecha_nacimiento is not null;

create or replace function chequear_adulto(p_funcion_id bigint, p_codigo text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_c compras; v_codigo text := upper(trim(coalesce(p_codigo, '')));
begin
  if v_codigo !~ '^[0-9A-F]{12}$' then
    return jsonb_build_object('ok', false, 'motivo', 'El código no existe');
  end if;
  select * into v_c from compras where upper(codigo) = v_codigo;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'El código no existe');
  end if;
  if v_c.funcion_id is distinct from p_funcion_id then
    return jsonb_build_object('ok', false, 'motivo', 'Esa compra es de otra función');
  end if;
  if v_c.estado = 'cancelada' then
    return jsonb_build_object('ok', false, 'motivo', 'Esa compra está cancelada');
  end if;
  if not exists (select 1 from entradas e where e.compra_id = v_c.id and e.activa) then
    return jsonb_build_object('ok', false, 'motivo', 'Esa compra no tiene entradas activas');
  end if;
  if v_c.comprador_mayor is not true then
    return jsonb_build_object('ok', false, 'motivo', 'No pudimos verificar que esa compra sea de un adulto');
  end if;
  return jsonb_build_object('ok', true, 'motivo', 'Entrada de adulto verificada para esta función', 'codigo', v_c.codigo);
end $$;

create or replace function verificar_adulto(p_funcion_id bigint, p_codigo text)
returns jsonb language sql stable security definer set search_path = public as $$
  select chequear_adulto(p_funcion_id, p_codigo) - 'codigo';
$$;

drop function if exists registrar_compra(bigint, bigint[], jsonb, text, text, numeric, date, text, text[], text, text, text, numeric);

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
  p_total_esperado numeric default null,
  p_adulto_codigo text default null)
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
  v_requiere_adulto boolean := false;
  v_adulto text;
  v_chequeo jsonb;
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
  if v_nac is not null then
    v_edad := extract(year from age(hoy_local(), v_nac))::int;
  end if;

  if v_p.restriccion_edad > 0 then
    if v_nac is null then
      raise exception 'Necesitamos tu fecha de nacimiento para esta película';
    end if;
    if v_edad < v_p.restriccion_edad then
      raise exception 'No cumplís la edad mínima (+%) para esta película', v_p.restriccion_edad;
    end if;
    if v_edad < 18 then
      v_requiere_adulto := true;
      if coalesce(trim(p_adulto_codigo), '') = '' then
        if v_cant < 2 then
          raise exception 'Como sos menor de 18, sumá la butaca del adulto que te acompaña o ingresá el código de su compra';
        end if;
      else
        v_chequeo := chequear_adulto(p_funcion_id, p_adulto_codigo);
        if not (v_chequeo->>'ok')::boolean then
          raise exception '%', v_chequeo->>'motivo';
        end if;
        v_adulto := v_chequeo->>'codigo';
      end if;
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

  insert into compras (usuario_id, email_contacto, codigo, funcion_id, requiere_adulto, adulto_codigo, comprador_mayor)
  values (v_uid, v_email, v_codigo, p_funcion_id, v_requiere_adulto, v_adulto, v_edad >= 18)
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

drop function if exists validar_qr(text, text);

create or replace function validar_qr(p_codigo text, p_tipo text, p_adulto_presente boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c compras; v_f funciones; v_p peliculas; v_a compras; v_extra jsonb;
begin
  if not es_empleado() then raise exception 'No autorizado'; end if;

  select * into v_c from compras where upper(codigo) = upper(trim(p_codigo)) for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'El código no existe'); end if;

  select * into v_f from funciones where id = v_c.funcion_id;
  select * into v_p from peliculas where id = v_f.pelicula_id;
  if v_c.adulto_codigo is not null then
    select * into v_a from compras where codigo = v_c.adulto_codigo;
  end if;

  v_extra := jsonb_build_object(
    'restriccion_edad', coalesce(v_p.restriccion_edad, 0),
    'requiere_adulto', v_c.requiere_adulto,
    'adulto_codigo', v_c.adulto_codigo,
    'adulto_estado', case when v_a.id is null then null
                          when v_a.estado = 'cancelada' then 'cancelada'
                          else 'vigente' end,
    'adulto_entrada_validada', v_a.entrada_validada);

  if v_c.estado = 'cancelada' then return jsonb_build_object('ok', false, 'motivo', 'La compra fue cancelada') || v_extra; end if;

  if p_tipo = 'entrada' then
    if v_c.funcion_id is null then return jsonb_build_object('ok', false, 'motivo', 'La compra no incluye entradas') || v_extra; end if;
    if v_c.entrada_validada then return jsonb_build_object('ok', false, 'motivo', 'La entrada ya fue utilizada') || v_extra; end if;
    if now() > v_f.fin then return jsonb_build_object('ok', false, 'motivo', 'La función ya terminó') || v_extra; end if;
    if (v_f.inicio at time zone 'America/Argentina/Buenos_Aires')::date > hoy_local() then
      return jsonb_build_object('ok', false, 'motivo',
        'La entrada es para el ' || to_char(v_f.inicio at time zone 'America/Argentina/Buenos_Aires', 'DD/MM "a las" HH24:MI')) || v_extra;
    end if;
    if v_c.requiere_adulto and not coalesce(p_adulto_presente, false) then
      return jsonb_build_object(
        'ok', false,
        'requiere_confirmacion', true,
        'motivo', 'Entrada de un menor: confirmá que ingresa con un adulto',
        'codigo', v_c.codigo,
        'pelicula', coalesce(v_p.titulo, ''),
        'inicio', v_f.inicio,
        'sala', (select nombre from salas where id = v_f.sala_id),
        'butacas', coalesce((select jsonb_agg(b.fila || b.numero order by b.fila, b.numero)
                               from entradas e join butacas b on b.id = e.butaca_id
                              where e.compra_id = v_c.id and e.activa), '[]'::jsonb),
        'items', coalesce((select jsonb_agg(jsonb_build_object('nombre', ci.nombre, 'cantidad', ci.cantidad))
                             from compra_items ci where ci.compra_id = v_c.id), '[]'::jsonb)
      ) || v_extra;
    end if;
    update compras set entrada_validada = true, entrada_validada_en = now() where id = v_c.id;
  elsif p_tipo = 'candy' then
    if not exists (select 1 from compra_items where compra_id = v_c.id) then
      return jsonb_build_object('ok', false, 'motivo', 'La compra no incluye productos') || v_extra;
    end if;
    if v_c.productos_entregados then return jsonb_build_object('ok', false, 'motivo', 'Los productos ya fueron entregados') || v_extra; end if;
    if v_f.id is not null and (v_f.inicio at time zone 'America/Argentina/Buenos_Aires')::date > hoy_local() then
      return jsonb_build_object('ok', false, 'motivo',
        'El pedido es para la función del ' || to_char(v_f.inicio at time zone 'America/Argentina/Buenos_Aires', 'DD/MM "a las" HH24:MI')) || v_extra;
    end if;
    update compras set productos_entregados = true, productos_entregados_en = now() where id = v_c.id;
    update compra_items set entregado = true where compra_id = v_c.id;
  else
    raise exception 'Tipo de validación inválido';
  end if;

  perform registrar_log('validar_qr', 'compra', v_c.id::text,
    jsonb_build_object('tipo', p_tipo, 'codigo', v_c.codigo)
    || case when p_tipo = 'entrada' and v_c.requiere_adulto
            then jsonb_build_object('adulto_presente', true)
            else '{}'::jsonb end);

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
  ) || v_extra;
end $$;

create or replace function correo_de_compra(p_compra_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_c compras; v_f funciones; v_p peliculas; v_sala text;
  v_butacas text; v_items text; v_cuerpo text; v_url text; v_titulo text; v_limite text;
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

  v_limite := case when v_f.id is null then '2 horas antes de la función'
    else 'el ' || to_char((v_f.inicio - interval '2 hours') at time zone 'America/Argentina/Buenos_Aires', 'DD/MM "a las" HH24:MI') || ' h' end;

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
       then '<p style="margin:18px 0 0;padding:12px 16px;background:rgba(240,82,79,.12);border-radius:10px;font:600 13px/1.5 Helvetica,Arial,sans-serif;color:#f0524f;">'
            || case when v_p.restriccion_edad >= 18
                    then 'Película +18: solo mayores de 18. Se pide DNI en la puerta.'
                    else 'Película +' || v_p.restriccion_edad || ': solo mayores de ' || v_p.restriccion_edad
                         || '. Los menores de 18 ingresan con un adulto que tenga su propia entrada.' end
            || case when v_c.requiere_adulto
                    then '<br><strong>'
                         || case when v_c.adulto_codigo is not null
                                 then 'Compra de un menor: entrás con el adulto de la compra ' || escapar_html(v_c.adulto_codigo)
                                 else 'Compra de un menor: el adulto que te acompaña está en esta misma compra' end
                         || '</strong>'
                    else '' end
            || '</p>'
       else '' end
    || '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 4px;"><tr><td style="background:#f5b43c;border-radius:10px;">'
    || '<a href="' || v_url || '" style="display:inline-block;padding:13px 26px;font:700 15px Helvetica,Arial,sans-serif;color:#14161d;text-decoration:none;">Ver mi entrada con el QR</a>'
    || '</td></tr></table>'
    || '<p style="margin:26px 0 0;padding-top:18px;border-top:1px solid #2a2f40;font:400 13px/1.7 Helvetica,Arial,sans-serif;color:#a8adbd;">'
    || '<strong style="color:#f2f3f7;">¿No vas a poder ir?</strong> '
    || case when v_f.inicio - now() < interval '2 hours'
       then 'Esta compra ya no se puede cancelar: el plazo cierra 2 horas antes de la función.'
       when v_c.usuario_id is null
       then 'Podés cancelar la compra hasta ' || v_limite || '. No devolvemos dinero: el importe queda como crédito en una cuenta de CineNova para tu próxima compra. '
            || '<a href="' || v_url || '#cancelar" style="color:#f5b43c;font-weight:700;">Cancelar mi compra</a>'
       else 'Podés cancelarla desde Mis compras hasta ' || v_limite || ' y el importe vuelve como crédito en tu cuenta. '
            || '<a href="' || coalesce(valor_de_configuracion('url_app'), '') || '/cuenta/compras" style="color:#f5b43c;font-weight:700;">Ir a Mis compras</a>' end
    || '</p>';

  perform enviar_correo(
    v_c.email_contacto,
    'Tu entrada para ' || v_titulo || ' · código ' || v_c.codigo,
    plantilla_correo('Tu compra quedó confirmada',
      'Guardá este correo: con el código de abajo entrás a la sala y retirás el candy bar.',
      v_cuerpo),
    'compra_confirmada');
end $$;

do $$
declare
  v_id uuid;
  r record;
begin
  for r in select * from (values
    ('menor@cinenova.app', 'menor1234', 'cliente', '{"nombre":"Tomás","apellido":"Rivas","fecha_nacimiento":"2010-03-15","tipo_sangre":"A+","color_ojos":"Marrones","dias_vacaciones":14}')
  ) as t(email, pass, rol, meta)
  loop
    if exists (select 1 from auth.users u where u.email = r.email) then continue; end if;

    v_id := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      phone_change, phone_change_token, email_change_token_current, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
      r.email, extensions.crypt(r.pass, extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, r.meta::jsonb,
      '', '', '', '', '', '', '', ''
    );

    insert into auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      v_id::text, v_id,
      jsonb_build_object('sub', v_id::text, 'email', r.email, 'email_verified', true),
      'email', now(), now(), now()
    );

    perform set_config('app.bypass_perfil', 'on', true);
    update perfiles set rol = r.rol::rol_usuario, credito = case when r.rol = 'cliente' then 5000 else 0 end
     where id = v_id;
  end loop;
end $$;

revoke execute on function chequear_adulto(bigint, text)                       from public, anon, authenticated;
revoke execute on function verificar_adulto(bigint, text)                      from public;
revoke execute on function registrar_compra(bigint, bigint[], jsonb, text, text, numeric, date, text, text[], text, text, text, numeric, text) from public;
revoke execute on function validar_qr(text, text, boolean)                     from public, anon;
revoke execute on function correo_de_compra(bigint)                            from public, anon, authenticated;

grant execute on function verificar_adulto(bigint, text)                       to anon, authenticated;
grant execute on function registrar_compra(bigint, bigint[], jsonb, text, text, numeric, date, text, text[], text, text, text, numeric, text) to anon, authenticated;
grant execute on function validar_qr(text, text, boolean)                      to authenticated;
