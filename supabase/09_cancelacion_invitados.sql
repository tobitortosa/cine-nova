create table if not exists cancelaciones_invitado (
  compra_id      bigint primary key references compras(id) on delete cascade,
  clave_hash     text not null check (clave_hash ~ '^[0-9a-f]{64}$'),
  solicitado_por uuid not null references perfiles(id) on delete cascade,
  expira_en      timestamptz not null,
  intentos       int not null default 0,
  envios         int not null default 1,
  ventana_desde  timestamptz not null default now(),
  ultimo_envio   timestamptz not null default now(),
  usado_en       timestamptz
);

alter table cancelaciones_invitado enable row level security;
revoke all on table cancelaciones_invitado from public, anon, authenticated;

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
  if v_c.usuario_id is null then
    raise exception 'Esta compra se hizo como invitado: la cancela quien la compró, desde su entrada, para recibir el crédito en una cuenta';
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
    'con_cuenta', v_c.usuario_id is not null,
    'propia', coalesce(v_c.usuario_id = auth.uid(), false),
    'sala', (select nombre from salas where id = v_f.sala_id),
    'butacas', coalesce((select jsonb_agg(jsonb_build_object('etiqueta', b.fila || b.numero, 'tipo', b.tipo) order by b.fila, b.numero)
                           from entradas e join butacas b on b.id = e.butaca_id
                          where e.compra_id = v_c.id and e.activa), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('nombre', ci.nombre, 'cantidad', ci.cantidad, 'precio_unitario', ci.precio_unitario))
                         from compra_items ci where ci.compra_id = v_c.id), '[]'::jsonb)
  );
end $$;

create or replace function pedir_codigo_cancelacion(p_codigo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_perfil perfiles; v_c compras; v_f funciones; v_p peliculas; v_s cancelaciones_invitado;
  v_clave text; v_expira timestamptz; v_cuerpo text; v_enviado boolean;
begin
  if v_uid is null then raise exception 'Ingresá a tu cuenta para recibir el crédito'; end if;
  select * into v_perfil from perfiles where id = v_uid;
  if not found then raise exception 'No encontramos los datos de tu cuenta. Escribinos para que lo revisemos.'; end if;
  if v_perfil.rol <> 'cliente' then
    return jsonb_build_object('ok', false, 'motivo', 'El crédito solo se acredita en cuentas de clientes. Ingresá con tu cuenta personal.');
  end if;

  select * into v_c from compras where upper(codigo) = upper(trim(coalesce(p_codigo, ''))) for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'No encontramos la compra'); end if;
  if v_c.estado = 'cancelada' then return jsonb_build_object('ok', false, 'motivo', 'La compra ya estaba cancelada'); end if;
  if v_c.usuario_id is not null then
    return jsonb_build_object('ok', false, 'cuenta', true, 'propia', v_c.usuario_id = v_uid,
      'motivo', case when v_c.usuario_id = v_uid
                     then 'Esta compra es de tu cuenta: cancelala desde Mis compras.'
                     else 'Esta compra se hizo con una cuenta de CineNova: solo esa cuenta la puede cancelar, desde Mis compras.' end);
  end if;
  if v_c.entrada_validada then return jsonb_build_object('ok', false, 'motivo', 'La entrada ya fue utilizada'); end if;
  if v_c.productos_entregados then return jsonb_build_object('ok', false, 'motivo', 'Los productos del candy bar ya fueron entregados'); end if;

  select * into v_f from funciones where id = v_c.funcion_id;
  if v_f.id is not null and v_f.inicio - now() < interval '2 hours' then
    return jsonb_build_object('ok', false, 'motivo', 'Solo se puede cancelar hasta 2 horas antes de la función');
  end if;

  select * into v_s from cancelaciones_invitado where compra_id = v_c.id for update;
  if found then
    if v_s.ultimo_envio > now() - interval '1 minute' and v_s.usado_en is null and v_s.expira_en > now() and v_s.intentos < 5 then
      return jsonb_build_object('ok', false, 'espera', true, 'motivo',
        'Te mandamos un código hace menos de un minuto. Revisá tu correo, también la carpeta de spam, o esperá un momento para pedir otro.');
    end if;
    if v_s.ventana_desde > now() - interval '1 day' and v_s.envios >= 5 then
      return jsonb_build_object('ok', false, 'motivo',
        'Ya pediste 5 códigos para esta compra en las últimas 24 horas. Probá de nuevo más tarde.');
    end if;
  end if;

  v_clave := lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 7))::bit(28)::int) % 1000000)::text, 6, '0');
  v_expira := now() + interval '15 minutes';
  if v_f.id is not null then v_expira := least(v_expira, v_f.inicio - interval '2 hours'); end if;

  select * into v_p from peliculas where id = v_f.pelicula_id;
  v_cuerpo :=
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0b10;border:1px dashed #2a2f40;border-radius:12px;padding:18px;"><tr><td align="center">'
    || '<div style="font:700 11px Helvetica,Arial,sans-serif;color:#6b7185;letter-spacing:2px;">CÓDIGO PARA CANCELAR</div>'
    || '<div style="font:700 30px/1.6 Courier New,monospace;color:#f5b43c;letter-spacing:8px;">' || v_clave || '</div>'
    || '<div style="font:400 13px/1.6 Helvetica,Arial,sans-serif;color:#a8adbd;">Vence a las '
    || to_char(v_expira at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI') || ' h y sirve una sola vez. No se lo pases a nadie.</div>'
    || '</td></tr></table>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;background:#1a1d28;border-radius:12px;padding:20px 22px;">'
    || '<tr><td style="font:400 14px/1.9 Helvetica,Arial,sans-serif;color:#a8adbd;">'
    || '<strong style="color:#f2f3f7;">Película:</strong> ' || escapar_html(coalesce(v_p.titulo, '-')) || '<br>'
    || '<strong style="color:#f2f3f7;">Función:</strong> '
    || coalesce(to_char(v_f.inicio at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY "a las" HH24:MI') || ' h', 'A confirmar') || '<br>'
    || '<strong style="color:#f2f3f7;">Se acredita como crédito:</strong> <span style="color:#3fcf8e;">' || formato_pesos(v_c.total + v_c.credito_usado) || '</span><br>'
    || '<strong style="color:#f2f3f7;">Cuenta que lo pidió:</strong> ' || escapar_html(enmascarar_email(v_perfil.email))
    || '</td></tr></table>'
    || '<p style="margin:18px 0 0;font:400 13px/1.6 Helvetica,Arial,sans-serif;color:#a8adbd;">'
    || 'Si no lo pediste vos, ignorá este correo: sin este código nadie puede cancelar tu compra y tu entrada sigue siendo válida.</p>';

  v_enviado := enviar_correo(
    v_c.email_contacto,
    'Código para cancelar tu compra ' || v_c.codigo,
    plantilla_correo('Tu código para cancelar la compra',
      'Se pidió desde la entrada de la compra ' || escapar_html(v_c.codigo) || ' para cancelarla. Si fuiste vos, escribilo en esa misma página.',
      v_cuerpo),
    'cancelacion_codigo');

  if not v_enviado then
    return jsonb_build_object('ok', false, 'motivo', 'No pudimos enviar el correo con el código. Probá de nuevo en unos minutos.');
  end if;

  insert into cancelaciones_invitado as ci
    (compra_id, clave_hash, solicitado_por, expira_en, intentos, envios, ventana_desde, ultimo_envio, usado_en)
  values (v_c.id, huella_de_sesion(v_c.codigo || ':' || v_clave), v_uid, v_expira, 0, 1, now(), now(), null)
  on conflict (compra_id) do update set
    clave_hash = excluded.clave_hash, solicitado_por = excluded.solicitado_por,
    expira_en = excluded.expira_en, intentos = 0, usado_en = null, ultimo_envio = now(),
    envios = case when ci.ventana_desde <= now() - interval '1 day' then 1 else ci.envios + 1 end,
    ventana_desde = case when ci.ventana_desde <= now() - interval '1 day' then now() else ci.ventana_desde end;

  return jsonb_build_object('ok', true, 'email', enmascarar_email(v_c.email_contacto), 'vence', v_expira);
end $$;

create or replace function cancelar_compra_invitado(p_codigo text, p_clave text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_rol rol_usuario; v_c compras; v_s cancelaciones_invitado; v_restantes int;
begin
  if v_uid is null then raise exception 'Ingresá a tu cuenta para recibir el crédito'; end if;
  select rol into v_rol from perfiles where id = v_uid;
  if not found then raise exception 'No encontramos los datos de tu cuenta. Escribinos para que lo revisemos.'; end if;
  if v_rol <> 'cliente' then
    return jsonb_build_object('ok', false, 'motivo', 'El crédito solo se acredita en cuentas de clientes. Ingresá con tu cuenta personal.');
  end if;

  select * into v_c from compras where upper(codigo) = upper(trim(coalesce(p_codigo, ''))) for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'No encontramos la compra'); end if;
  if v_c.estado = 'cancelada' then return jsonb_build_object('ok', false, 'motivo', 'La compra ya estaba cancelada'); end if;
  if v_c.usuario_id is not null then
    return jsonb_build_object('ok', false, 'cuenta', true, 'motivo', 'Esta compra se hizo con una cuenta: se cancela desde Mis compras.');
  end if;

  select * into v_s from cancelaciones_invitado where compra_id = v_c.id for update;
  if not found or v_s.usado_en is not null or v_s.expira_en <= now() or v_s.intentos >= 5 then
    return jsonb_build_object('ok', false, 'vencido', true, 'motivo', 'El código venció o ya no es válido. Pedí uno nuevo.');
  end if;
  if v_s.solicitado_por <> v_uid then
    return jsonb_build_object('ok', false, 'motivo', 'Ese código se pidió con otra cuenta. Pedí uno nuevo con la cuenta donde querés recibir el crédito.');
  end if;
  if coalesce(trim(p_clave), '') !~ '^[0-9]{6}$' or v_s.clave_hash <> huella_de_sesion(v_c.codigo || ':' || trim(p_clave)) then
    update cancelaciones_invitado
       set intentos = intentos + 1,
           expira_en = case when intentos + 1 >= 5 then now() else expira_en end
     where compra_id = v_c.id
    returning 5 - intentos into v_restantes;
    v_restantes := greatest(v_restantes, 0);
    return jsonb_build_object('ok', false, 'restantes', v_restantes, 'vencido', v_restantes = 0,
      'motivo', case when v_restantes > 0
                     then 'El código no es correcto. Te ' || case when v_restantes = 1 then 'queda 1 intento.' else 'quedan ' || v_restantes || ' intentos.' end
                     else 'Te equivocaste 5 veces. Pedí un código nuevo.' end);
  end if;

  update compras set usuario_id = v_uid where id = v_c.id;
  select * into v_c from cancelar_compra(v_c.id);
  update cancelaciones_invitado set usado_en = now() where compra_id = v_c.id;

  return jsonb_build_object('ok', true, 'credito', v_c.total + v_c.credito_usado);
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
       then '<p style="margin:18px 0 0;padding:12px 16px;background:rgba(240,82,79,.12);border-radius:10px;font:600 13px/1.5 Helvetica,Arial,sans-serif;color:#f0524f;">Película +'
            || v_p.restriccion_edad || ': los menores deben ingresar acompañados por un adulto.</p>'
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

drop policy if exists compras_admin on compras;
drop policy if exists entradas_admin on entradas;
drop policy if exists compra_items_admin on compra_items;

revoke execute on function pedir_codigo_cancelacion(text)        from public, anon;
revoke execute on function cancelar_compra_invitado(text, text)  from public, anon;
revoke execute on function cancelar_compra(bigint)               from public, anon;
revoke execute on function correo_de_compra(bigint)              from public, anon, authenticated;

grant execute on function pedir_codigo_cancelacion(text)         to authenticated;
grant execute on function cancelar_compra_invitado(text, text)   to authenticated;
grant execute on function cancelar_compra(bigint)                to authenticated;
grant execute on function buscar_compra(text)                    to anon, authenticated;
